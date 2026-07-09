#!/usr/bin/env python3
"""Fleet dashboard: pixel-art cat cafe view of Claude Code sessions, processes, and Docker.

Samples three sources on background threads and serves a live dashboard:
  - `ps` process trees rooted at each running `claude` process (what they're running, CPU)
  - `docker ps` + `docker stats` (container CPU/memory)
  - `~/.claude/projects/*/<session>.jsonl` transcript tails (what each session is doing)
    plus `<session>/subagents/*.jsonl` (each subagent is a kitten beside its parent cat)

Each active session is a pixel-art cat on a bed or cat tree with a speech bubble
showing its latest tool call. Stdlib only. Run:  python3 fleet_dashboard.py [--port 8787]
Then open http://localhost:8787
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import threading
import time
from collections import defaultdict, deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROJECTS_DIRECTORY = Path.home() / ".claude" / "projects"
SESSION_ACTIVE_WINDOW_SECONDS = 900
LONG_WAIT_WINDOW_SECONDS = 4 * 3600  # cap for sessions waiting on tools/background tasks
TRANSCRIPT_TAIL_BYTES = 1_048_576
TRANSCRIPT_HEAD_BYTES = 16_384
MAX_EVENTS_PER_SESSION = 12
HISTORY_LENGTH = 300
PROCESS_SAMPLE_SECONDS = 1.0
DOCKER_SAMPLE_SECONDS = 2.0
SESSION_SAMPLE_SECONDS = 1.0
GPU_SAMPLE_SECONDS = 1.0

PS_COMMAND = ["ps", "-Ao", "pid,ppid,pcpu,pmem,rss,etime,args"]
GPU_COMMAND = ["ioreg", "-r", "-d", "1", "-w0", "-c", "IOAccelerator"]
GPU_UTILIZATION_PATTERN = re.compile(r'"Device Utilization %"=(\d+)')
SNAPSHOT_EVAL_PATTERN = re.compile(r"eval '(.*)' < /dev/null")
BACKGROUND_LAUNCH_PATTERN = re.compile(r"running in background with ID: ([A-Za-z0-9_-]{6,})")
AGENT_LAUNCH_PATTERN = re.compile(r"agentId: ([A-Za-z0-9_-]{6,})")
TASK_DONE_PATTERN = re.compile(r"<task-id>([A-Za-z0-9_-]{6,})</task-id>")
OWN_SESSION_ID = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
SERVER_STARTED = time.time()


class State:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.trees: list[dict] = []
        self.docker: list[dict] = []
        self.sessions: list[dict] = []
        self.history: deque = deque(maxlen=HISTORY_LENGTH)
        self.cpu_count = os.cpu_count() or 1
        self.gpu_utilization: int | None = None


STATE = State()


# ---------------------------------------------------------------- processes

def read_process_table() -> dict[int, dict]:
    result = subprocess.run(PS_COMMAND, capture_output=True, text=True, timeout=10)
    table: dict[int, dict] = {}
    for line in result.stdout.splitlines()[1:]:
        parts = line.split(None, 6)
        if len(parts) < 7:
            continue
        try:
            table[int(parts[0])] = {
                "pid": int(parts[0]),
                "ppid": int(parts[1]),
                "cpu": float(parts[2]),
                "rss_kb": int(parts[4]),
                "elapsed": parts[5],
                "args": parts[6],
            }
        except ValueError:
            continue
    return table


def is_claude_process(process: dict) -> bool:
    first_token = process["args"].split()[0] if process["args"] else ""
    return os.path.basename(first_token) == "claude"


def readable_command(args: str) -> tuple[str, bool]:
    """Extract the human command from a Claude Code shell-snapshot wrapper."""
    match = SNAPSHOT_EVAL_PATTERN.search(args)
    if match:
        return match.group(1).replace("'\"'\"'", "'"), True
    return args, False


def collect_self_subtree(children: dict[int, list[int]]) -> set[int]:
    """The dashboard's own process subtree (its ps/docker calls) — excluded from display."""
    excluded: set[int] = set()
    stack = [os.getpid()]
    while stack:
        pid = stack.pop()
        excluded.add(pid)
        stack.extend(children.get(pid, []))
    return excluded


def walk_tree(root_pid: int, table: dict[int, dict], children: dict[int, list[int]],
              excluded: set[int]) -> dict:
    rows: list[dict] = []
    total_cpu = 0.0
    total_rss_kb = 0
    process_count = 0
    stack = [(root_pid, 0)]
    while stack:
        pid, depth = stack.pop()
        if pid in excluded or pid not in table:
            continue
        process = table[pid]
        total_cpu += process["cpu"]
        total_rss_kb += process["rss_kb"]
        process_count += 1
        for child_pid in sorted(children.get(pid, []), reverse=True):
            stack.append((child_pid, depth + 1))
        if depth == 0:
            continue
        command, is_wrapper = readable_command(process["args"])
        if is_wrapper or depth == 1 or process["cpu"] >= 1.0:
            rows.append({
                "pid": pid,
                "depth": depth,
                "cpu": process["cpu"],
                "elapsed": process["elapsed"],
                "command": command,
                "is_wrapper": is_wrapper,
            })
    rows.sort(key=lambda row: row["cpu"], reverse=True)
    root = table[root_pid]
    return {
        "pid": root_pid,
        "elapsed": root["elapsed"],
        "cpu": round(total_cpu, 1),
        "rss_mb": total_rss_kb // 1024,
        "process_count": process_count,
        "rows": rows,
    }


def sample_processes() -> None:
    table = read_process_table()
    children: dict[int, list[int]] = defaultdict(list)
    for process in table.values():
        children[process["ppid"]].append(process["pid"])
    excluded = collect_self_subtree(children)
    roots = [
        process for process in table.values()
        if is_claude_process(process)
        and not (process["ppid"] in table and is_claude_process(table[process["ppid"]]))
    ]
    trees = [walk_tree(root["pid"], table, children, excluded)
             for root in sorted(roots, key=lambda process: process["pid"])]
    total_cores = sum(process["cpu"] for pid, process in table.items()
                      if pid not in excluded) / 100.0
    claude_cores = sum(tree["cpu"] for tree in trees) / 100.0
    with STATE.lock:
        docker_cores = sum(container["cpu"] for container in STATE.docker) / 100.0
        STATE.trees = trees
        STATE.history.append({
            "t": time.time(),
            "claude": round(claude_cores, 2),
            "docker": round(docker_cores, 2),
            "total": round(total_cores, 2),
        })


# ------------------------------------------------------------------- docker

def read_docker_lines(command: list[str], timeout: int) -> list[str]:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []
    if result.returncode != 0:
        return []
    return [line for line in result.stdout.splitlines() if line.strip()]


def sample_docker() -> None:
    status_lines = read_docker_lines(
        ["docker", "ps", "--format", "{{.Names}}\t{{.Status}}"], timeout=15)
    statuses = {}
    for line in status_lines:
        parts = line.split("\t")
        if len(parts) == 2:
            statuses[parts[0]] = parts[1]
    stats_lines = read_docker_lines(
        ["docker", "stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"],
        timeout=25)
    containers = []
    for line in stats_lines:
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        try:
            cpu = float(parts[1].rstrip("%"))
        except ValueError:
            cpu = 0.0
        containers.append({
            "name": parts[0],
            "status": statuses.get(parts[0], ""),
            "cpu": cpu,
            "memory": parts[2],
        })
    containers.sort(key=lambda container: container["cpu"], reverse=True)
    with STATE.lock:
        STATE.docker = containers


# ---------------------------------------------------------------------- gpu

def sample_gpu() -> None:
    try:
        result = subprocess.run(GPU_COMMAND, capture_output=True, text=True, timeout=10)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return
    utilizations = GPU_UTILIZATION_PATTERN.findall(result.stdout)
    with STATE.lock:
        STATE.gpu_utilization = (
            max(int(value) for value in utilizations) if utilizations else None)


# ----------------------------------------------------------------- sessions

def read_file_slice(path: Path, offset: int, size: int) -> str:
    with open(path, "rb") as handle:
        handle.seek(offset)
        return handle.read(size).decode("utf-8", errors="replace")


def parse_json_lines(text: str, skip_first_partial: bool) -> list[dict]:
    lines = text.split("\n")
    if skip_first_partial and lines:
        lines = lines[1:]
    parsed = []
    for line in lines:
        if not line.strip():
            continue
        try:
            parsed.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return parsed


def extract_text_content(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                return item.get("text", "")
    return ""


def describe_tool_input(tool_input: dict) -> str:
    questions = tool_input.get("questions")
    if isinstance(questions, list) and questions and isinstance(questions[0], dict):
        question_text = questions[0].get("question")
        if isinstance(question_text, str) and question_text.strip():
            return question_text
    for key in ("description", "command", "file_path", "pattern", "prompt", "url",
                "skill", "query", "subject"):
        value = tool_input.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return next((value for value in tool_input.values()
                 if isinstance(value, str) and value.strip()), "")


def session_title(head_entries: list[dict]) -> str:
    for entry in head_entries:
        if entry.get("type") == "summary" and entry.get("summary"):
            return entry["summary"]
    for entry in head_entries:
        if entry.get("type") == "user" and isinstance(entry.get("message"), dict):
            text = extract_text_content(entry["message"]).strip()
            if text and not text.startswith("<"):
                return text.split("\n")[0]
    return ""


def parse_entry_timestamp(entry: dict) -> float | None:
    raw = entry.get("timestamp")
    if not isinstance(raw, str):
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def extract_events(tail_entries: list[dict]) -> tuple[list[dict], str, str, float | None]:
    events: list[dict] = []
    branch = ""
    model = ""
    last_activity: float | None = None
    for entry in tail_entries:
        entry_time = parse_entry_timestamp(entry)
        if entry_time is not None:
            last_activity = max(last_activity or 0.0, entry_time)
        if entry.get("gitBranch"):
            branch = entry["gitBranch"]
        if entry.get("type") != "assistant" or not isinstance(entry.get("message"), dict):
            continue
        message = entry["message"]
        model = message.get("model") or model
        sidechain = bool(entry.get("isSidechain"))
        timestamp = entry.get("timestamp", "")
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "tool_use":
                events.append({
                    "time": timestamp,
                    "tool": item.get("name", "?"),
                    "detail": describe_tool_input(item.get("input", {}) or {}),
                    "sidechain": sidechain,
                })
            elif item.get("type") == "text" and item.get("text", "").strip():
                events.append({
                    "time": timestamp,
                    "tool": "say",
                    "detail": item["text"].strip(),
                    "sidechain": sidechain,
                })
    return events[-MAX_EVENTS_PER_SESSION:], branch, model, last_activity


ASK_USER_QUESTION_TOOL = "AskUserQuestion"


def detect_awaiting(tail_entries: list[dict]) -> str:
    """What the session is waiting on, from its last meaningful transcript entry.

    "question" — last entry is an unanswered AskUserQuestion: waiting on the user.
    "tool"     — last entry is another unanswered tool call: mid-execution (a long
                 Bash writes nothing until it finishes, so mtime reads as idle).
    "model"    — last entry is a tool result / user message: the model is computing.
    "user"     — last entry is a plain assistant text: done / awaiting input.
    """
    for entry in reversed(tail_entries):
        entry_type = entry.get("type")
        if entry_type == "assistant" and isinstance(entry.get("message"), dict):
            content = entry["message"].get("content")
            tool_names = [item.get("name") for item in content
                          if isinstance(item, dict) and item.get("type") == "tool_use"] \
                if isinstance(content, list) else []
            if tool_names:
                return "question" if ASK_USER_QUESTION_TOOL in tool_names else "tool"
            return "user"
        if entry_type == "user":
            return "model"
    return "user"


def pending_background_tasks(tail_entries: list[dict]) -> int:
    """Background launches without a matching completion notification.

    Only tool results and notifications (user-type entries) are scanned —
    assistant prose can QUOTE these phrases (e.g. explaining this very feature)
    and must not conjure phantom tasks.
    """
    launched: set[str] = set()
    completed: set[str] = set()
    for entry in tail_entries:
        if entry.get("type") != "user":
            continue
        text = json.dumps(entry.get("message", {}))
        launched.update(BACKGROUND_LAUNCH_PATTERN.findall(text))
        launched.update(AGENT_LAUNCH_PATTERN.findall(text))
        completed.update(TASK_DONE_PATTERN.findall(text))
    return len(launched - completed)


def parse_session(path: Path, modified_at: float, project_name: str,
                  parent_id: str) -> dict:
    file_size = path.stat().st_size
    head_entries = parse_json_lines(
        read_file_slice(path, 0, TRANSCRIPT_HEAD_BYTES), skip_first_partial=False)
    tail_offset = max(0, file_size - TRANSCRIPT_TAIL_BYTES)
    tail_text = read_file_slice(path, tail_offset, TRANSCRIPT_TAIL_BYTES)
    tail_entries = parse_json_lines(tail_text, skip_first_partial=tail_offset > 0)
    events, branch, model, last_activity = extract_events(tail_entries)
    session_id = path.stem
    return {
        "id": session_id,
        "parent_id": parent_id,
        "project": project_name.lstrip("-").replace("-", "/"),
        "title": session_title(head_entries),
        "branch": branch,
        "model": model,
        "events": events,
        # conversation time, not file mtime: harness housekeeping (pr-link,
        # file-history-snapshot, last-prompt) appends untimestamped entries to
        # old transcripts, and those must not resurrect sleeping cats
        "modified_at": last_activity if last_activity is not None else modified_at,
        "awaiting": detect_awaiting(tail_entries),
        "pending_tasks": pending_background_tasks(tail_entries),
        "is_self": session_id == OWN_SESSION_ID,
    }


def collect_transcripts(project_directory: Path) -> list[tuple[Path, str]]:
    """(transcript path, parent session id) pairs — main sessions and their subagents."""
    found = [(transcript, "") for transcript in project_directory.glob("*.jsonl")]
    for transcript in project_directory.glob("*/subagents/*.jsonl"):
        found.append((transcript, transcript.parent.parent.name))
    return found


TASK_LIVENESS_TTL_SECONDS = 30.0
TASK_LIVENESS_GRACE_SECONDS = 120.0
task_liveness_cache: dict[str, tuple[float, bool]] = {}


def background_tasks_alive(project_directory_name: str, session_id: str,
                           now: float) -> bool:
    """A running background task holds its output file open under the session's
    scratchpad tasks dir — if nothing does, the pending tasks are orphans of a
    terminated session and must not keep its cat on coffee duty."""
    cached = task_liveness_cache.get(session_id)
    if cached and now - cached[0] < TASK_LIVENESS_TTL_SECONDS:
        return cached[1]
    alive = False
    pattern = f"/private/tmp/claude-*/{project_directory_name}/{session_id}/tasks"
    for tasks_directory in glob.glob(pattern):
        try:
            result = subprocess.run(["lsof", "-t", "+D", tasks_directory],
                                    capture_output=True, text=True, timeout=10)
        except subprocess.TimeoutExpired:
            alive = True  # fail open: never evict a possibly-live waiter on a probe hiccup
            break
        if result.stdout.strip():
            alive = True
            break
    task_liveness_cache[session_id] = (now, alive)
    return alive


def latest_kitten_activity(entries: list[tuple[Path, str, float]]) -> dict[str, float]:
    latest: dict[str, float] = {}
    for _, parent_id, modified_at in entries:
        if parent_id:
            latest[parent_id] = max(latest.get(parent_id, 0.0), modified_at)
    return latest


def sample_sessions() -> None:
    now = time.time()
    sessions = []
    if PROJECTS_DIRECTORY.is_dir():
        for project_directory in PROJECTS_DIRECTORY.iterdir():
            if not project_directory.is_dir():
                continue
            entries = []
            for transcript, parent_id in collect_transcripts(project_directory):
                try:
                    entries.append((transcript, parent_id, transcript.stat().st_mtime))
                except OSError:
                    continue
            kitten_latest = latest_kitten_activity(entries)
            for transcript, parent_id, modified_at in entries:
                # a dormant parent with busy kittens is still active — its
                # supervision is just waiting on them
                effective = modified_at if parent_id else max(
                    modified_at, kitten_latest.get(transcript.stem, 0.0))
                if now - effective > LONG_WAIT_WINDOW_SECONDS:
                    continue
                session = parse_session(
                    transcript, modified_at, project_directory.name, parent_id)
                if (session["pending_tasks"] and not parent_id
                        and now - session["modified_at"] > TASK_LIVENESS_GRACE_SECONDS
                        and not background_tasks_alive(
                            project_directory.name, transcript.stem, now)):
                    session["pending_tasks"] = 0  # orphaned by a terminated session
                fresh = now - session["modified_at"] <= SESSION_ACTIVE_WINDOW_SECONDS
                kittens_fresh = (not parent_id and
                    now - kitten_latest.get(transcript.stem, 0.0)
                    <= SESSION_ACTIVE_WINDOW_SECONDS)
                # mid-tool or awaiting background tasks = still on shift, even
                # if the transcript has been quiet past the normal window
                waiting = (session["awaiting"] == "tool"
                           or session["pending_tasks"] > 0)
                if not (fresh or kittens_fresh or waiting):
                    continue
                sessions.append(session)
    sessions.sort(key=lambda session: session["modified_at"], reverse=True)
    with STATE.lock:
        STATE.sessions = sessions


# ------------------------------------------------------------------- server

def run_sampler(sample_function, interval_seconds: float) -> None:
    while True:
        started = time.time()
        try:
            sample_function()
        except Exception as error:  # top-level thread supervisor: never let a sampler die
            print(f"sampler {sample_function.__name__} error: {error!r}")
        time.sleep(max(0.2, interval_seconds - (time.time() - started)))


def prune_dead_sessions(sessions: list[dict], live_claude_count: int,
                        processes_sampled: bool) -> list[dict]:
    """Seats are limited to the number of live claude processes.

    A killed session's transcript stays recently-modified for the whole activity
    window, so mtime alone leaves ghost cats behind (e.g. after a VS Code window
    reload kills the terminals). Each top-level session is exactly one `claude`
    process, so the N most-recently-active sessions are the live ones.
    """
    if not processes_sampled:
        return sessions
    kitten_latest: dict[str, float] = {}
    for session in sessions:
        if session["parent_id"]:
            kitten_latest[session["parent_id"]] = max(
                kitten_latest.get(session["parent_id"], 0.0), session["modified_at"])

    def effective_activity(cat: dict) -> float:
        return max(cat["modified_at"], kitten_latest.get(cat["id"], 0.0))

    cats = sorted((session for session in sessions if not session["parent_id"]),
                  key=effective_activity, reverse=True)
    keep = {session["id"] for session in cats[:live_claude_count]}
    return [session for session in sessions
            if session["id"] in keep or session["parent_id"] in keep]


DEMO_MODE = False


def demo_event(now: float, seconds_ago: float, tool: str, detail: str,
               sidechain: bool = False) -> dict:
    stamp = datetime.fromtimestamp(now - seconds_ago).astimezone().isoformat()
    return {"time": stamp, "tool": tool, "detail": detail, "sidechain": sidechain}


def build_demo_snapshot() -> dict:
    """A curated synthetic scene (one cat per state) for previews / the README.
    Served only under --demo; needs no real processes, docker, or transcripts."""
    now = time.time()

    def cat(session_id, branch, ago, awaiting, pending, events, parent=""):
        return {
            "id": session_id, "parent_id": parent, "project": "you/project",
            "title": "", "branch": branch, "model": "claude-sonnet",
            "events": events, "modified_at": now - ago,
            "awaiting": awaiting, "pending_tasks": pending, "is_self": False,
        }

    sessions = [
        cat("demo-working-a3", "fix-auth-timeout", 4, "model", 0,
            [demo_event(now, 4, "Edit", "penny/auth/session.py")]),
        cat("demo-waiting-b7", "flaky-test-retry-loop", 95, "user", 2,
            [demo_event(now, 95, "Bash", "pytest -x tests/test_flaky.py")]),
        cat("demo-asking-c5", "reword-error-messages", 22, "user", 0,
            [demo_event(now, 22, "say", "Which tone — playful or matter-of-fact?")]),
        cat("demo-asleep-d4", "nightly-benchmarks", 720, "user", 0,
            [demo_event(now, 720, "say", "Benchmarks done — all green.")]),
        cat("demo-working-e8", "index-embeddings", 8, "tool", 0,
            [demo_event(now, 8, "Bash", "make embed-index")]),
        cat("demo-kit-work-1", "", 6, "model", 0,
            [demo_event(now, 6, "Grep", "def authenticate(", True)], "demo-working-a3"),
        cat("demo-kit-work-2", "", 3, "tool", 0,
            [demo_event(now, 3, "Read", "penny/auth/tokens.py", True)], "demo-working-a3"),
        cat("demo-kit-play-3", "", 430, "user", 0,
            [demo_event(now, 430, "say", "done", True)], "demo-working-a3"),
        cat("demo-kit-work-4", "", 5, "model", 0,
            [demo_event(now, 5, "Edit", "similarity/embeddings.py", True)], "demo-working-e8"),
    ]
    docker = [
        {"name": "signal-api", "status": "Up 3h", "cpu": 46.0, "memory": "180MiB / 2GiB"},
        {"name": "penny", "status": "Up 3h", "cpu": 78.0, "memory": "420MiB / 4GiB"},
        {"name": "team-worker", "status": "Up 1h", "cpu": 12.0, "memory": "90MiB / 2GiB"},
        {"name": "ollama", "status": "Up 3h", "cpu": 4.0, "memory": "1.1GiB / 8GiB"},
    ]
    trees = [{
        "pid": 1000, "elapsed": "12:34", "cpu": 320.0, "rss_mb": 900,
        "process_count": 8, "rows": [
            {"pid": 1, "depth": 1, "cpu": 180.0, "elapsed": "03:20", "is_wrapper": True,
             "command": "EVAL_SAMPLES=5 make eval EVAL_PYTEST_ARGS=tests/eval"},
            {"pid": 2, "depth": 1, "cpu": 90.0, "elapsed": "01:12", "is_wrapper": True,
             "command": "pytest -x tests/test_flaky.py"},
            {"pid": 3, "depth": 1, "cpu": 40.0, "elapsed": "00:40", "is_wrapper": True,
             "command": "make embed-index"},
        ],
    }]
    history = [{"t": now - (5 - i), "claude": 4.6, "docker": 1.4, "total": 7.3}
               for i in range(5)]
    return {
        "generated_at": now, "server_started": SERVER_STARTED, "cpu_count": 10,
        "gpu": 88, "trees": trees, "docker": docker,
        "sessions": sessions, "history": history,
    }


def snapshot() -> dict:
    if DEMO_MODE:
        return build_demo_snapshot()
    with STATE.lock:
        return {
            "generated_at": time.time(),
            "server_started": SERVER_STARTED,
            "cpu_count": STATE.cpu_count,
            "gpu": STATE.gpu_utilization,
            "trees": STATE.trees,
            "docker": STATE.docker,
            "sessions": prune_dead_sessions(
                STATE.sessions, len(STATE.trees), bool(STATE.history)),
            "history": list(STATE.history),
        }


class DashboardHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/data":
            body = json.dumps(snapshot()).encode("utf-8")
            content_type = "application/json"
        elif self.path == "/":
            bootstrap = json.dumps(snapshot()).replace("</", "<\\/")
            body = PAGE_HTML.replace('"__BOOTSTRAP__"', bootstrap).encode("utf-8")
            content_type = "text/html; charset=utf-8"
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path != "/client-log":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length).decode("utf-8", errors="replace")
        print(f"[client {time.strftime('%H:%M:%S')}] {body}", flush=True)
        self.send_response(204)
        self.end_headers()

    def log_message(self, format: str, *arguments) -> None:
        pass


PAGE_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nekomata</title>
<style>
  :root {
    --ink: #ffffff; --ink-2: #c3c2b7; --ink-3: #898781;
    --good: #0ca30c; --critical: #d03b3b;
    --mono: ui-monospace, "SF Mono", Menlo, monospace;
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: #2b211d; height: 100vh; overflow: hidden;
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  #stage { position: fixed; inset: 0; }
  #scene { position: absolute; inset: 0; width: 100%; height: 100%;
    image-rendering: pixelated; object-fit: contain; }
  #overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  #corner { position: fixed; left: 50%; transform: translateX(-50%);
    bottom: 10px; z-index: 5; white-space: nowrap;
    font-family: var(--mono); font-size: 11px; color: #dfc9b2;
    background: rgba(59,41,33,0.85); border-radius: 6px; padding: 4px 9px;
    font-variant-numeric: tabular-nums; }
  #corner .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    background: var(--good); margin-right: 6px; }
  #corner.stale .dot { background: var(--critical); }
  .bubble {
    position: absolute; transform: translate(-50%, -100%);
    width: max-content; z-index: 6;
    background: #fffaf2; color: #43302a; border-radius: 9px;
    border: 1px solid rgba(122, 84, 58, 0.4);
    padding: 5px 9px; font-family: var(--mono); font-size: 11px; line-height: 1.35;
    max-width: 205px; box-shadow: 0 2px 0 rgba(105, 68, 44, 0.35);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden; overflow-wrap: anywhere;
  }
  .bubble::after {
    content: ""; position: absolute; left: 50%; bottom: -6px; margin-left: -6px;
    border: 6px solid transparent; border-top-color: #fffaf2; border-bottom: none;
  }
  .bubble .icon { margin-right: 4px; }
  .bubble.zzz { background: #efe3d3; color: #8a6f5e; }
  .bubble.zzz::after { border-top-color: #efe3d3; }
  .bubble.mini { max-width: 150px; font-size: 10px; padding: 3px 7px;
    -webkit-line-clamp: 1; }
  .bubble.mini::after { display: none; }
  .bubble.side-right { transform: translate(0, -50%); }
  .bubble.side-left { transform: translate(-100%, -50%); }
  .nametag {
    position: absolute; transform: translate(-50%, 0); z-index: 2;
    font-size: 11px; font-weight: 700; color: #43302a; text-align: center;
    text-shadow: 0 1px 0 rgba(255,250,240,0.5);
    max-width: 210px; overflow: hidden; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .nametag .side-badge { color: #7a5a48; font-weight: 500; }
  .board-text {
    position: absolute; z-index: 1; font-family: var(--mono); color: #f2e4cf;
    overflow: hidden; display: flex; flex-direction: column; justify-content: flex-start;
  }
  .board-text .board-title { font-weight: 700; letter-spacing: 0.5px; color: #fffaf2; }
  .board-text div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rack-label { position: absolute; z-index: 1; transform: translate(-50%, 0); text-align: center;
    font-size: 10.5px; color: #7a5a48; font-variant-numeric: tabular-nums;
    white-space: nowrap; }
  .empty-office { position: absolute; inset: 0; display: flex; align-items: center;
    justify-content: center; color: #8a6f5e; font-size: 14px; }
  .hover-target { position: absolute; z-index: 3; pointer-events: auto; cursor: pointer; }
  #hovercard { position: fixed; display: none; z-index: 20; pointer-events: none;
    background: #fffaf2; color: #43302a; border: 1px solid rgba(122,84,58,0.5);
    border-radius: 9px; padding: 7px 10px; font-family: var(--mono); font-size: 11px;
    line-height: 1.4; max-width: 330px; max-height: 180px; overflow: hidden;
    box-shadow: 0 3px 8px rgba(60,35,20,0.35); overflow-wrap: anywhere; }
  #hovercard .who { font-weight: 700; }
  #hovercard .when { color: #8a6f5e; margin-left: 6px; font-size: 10px; }
</style>
</head>
<body>
<div id="stage">
  <canvas id="scene" width="720" height="360"></canvas>
  <div id="overlay"></div>
</div>
<div id="corner"><span class="dot"></span><span id="corner-text">connecting…</span></div>
<div id="hovercard"></div>

<script>
"use strict";
// ------------------------------------------------------------ constants
const PALETTE = ["#3987e5", "#199e70", "#c98500", "#008300",
                 "#9085e9", "#e66767", "#d55181", "#d95926"];
const SCENE_W = 720, SCENE_H = 360, WALL_H = 92;
let sceneH = SCENE_H;
let spots = [];
const TOOL_ICONS = {
  Read: "\u{1F4D6}", Edit: "✏️", Write: "\u{1F4DD}", Bash: "\u{1F4BB}",
  Grep: "\u{1F50D}", Glob: "\u{1F50D}", Task: "\u{1F916}", Agent: "\u{1F916}",
  WebFetch: "\u{1F310}", WebSearch: "\u{1F310}", Skill: "⚡",
  SendMessage: "\u{1F4E8}", TodoWrite: "✅", TaskCreate: "✅",
  TaskUpdate: "✅", say: "\u{1F4AC}", AskUserQuestion: "❓",
};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

// cat bitmaps: . transparent  S fur  T dark fur  K pupils  P nose/inner ear  W eye white
// big round eyes + tiny nose + pear body + thick upright tail (reference-cat style)
const CAT_SIT_A = [
"..S..........S..",
"..SS........SS..",
"..SPS......SPS..",
"..SSSSSSSSSSSS..",
"..SSSSSSSSSSSS..",
"..SSKSSSSKSSSS..",
"..SKSKSSKSKSSS..",
"..SSSSSSSSSSSS..",
"..SSSSSPSSSSSS..",
"...SSSSSSSSSS...",
"....SSSSSSSS..SS",
"...SSSSSSSSSS.SS",
"..SSSSSSSSSSS.SS",
"..SSSSSSSSSSS.SS",
".SSSSSSSSSSSS.SS",
".SSSSS.SSSSSS.SS",
".SSSSS.SSSSSSSS.",
"..SSS...SSS.....",
];
const CAT_SIT_B = [
"..S..........S..",
"..SS........SS..",
"..SPS......SPS..",
"..SSSSSSSSSSSS..",
"..SSSSSSSSSSSS..",
"..SSKSSSSKSSSS..",
"..SKSKSSKSKSSS..",
"..SSSSSSSSSSSS..",
"..SSSSSPSSSSSS..",
"...SSSSSSSSSS...",
"....SSSSSSSS....",
"...SSSSSSSSSS.SS",
"..SSSSSSSSSSS.SS",
"..SSSSSSSSSSS.SS",
".SSSSSSSSSSSS.SS",
".SSSSS.SSSSSS.SS",
".SSSSS.SSSSSSSS.",
"..SSS...SSS.....",
];
const CAT_SLEEP = [
"..S..S..........",
".SSSSSS..SSSS...",
".SSSSSSSSSSSSSS.",
".SKKSKKSSSSSSSS.",
".SPSSSSSSSSSSSS.",
".SSSSSSSSSSSSSS.",
".SSSSSSSSSSSSSS.",
"..SSSSSSSSSSSS..",
"..TTTSSSSSSTT...",
];
// inhale: the flank swells one pixel
const CAT_SLEEP_BREATHE = [
"..S..S...SSSS...",
".SSSSSS.SSSSSS..",
".SSSSSSSSSSSSSS.",
".SKKSKKSSSSSSSS.",
".SPSSSSSSSSSSSS.",
".SSSSSSSSSSSSSS.",
".SSSSSSSSSSSSSS.",
"..SSSSSSSSSSSS..",
"..TTTSSSSSSTT...",
];
const KITTEN = [
".S...S..",
".SSSSS..",
".SKSKS..",
".SSSSS..",
"SSSSSSS.",
"SSSSSSST",
".SS.SS..",
];
// the adoption man: short, bald, glasses, shirt & tie (H skin, G glasses,
// W shirt, T tie, B pants, S shoes)
const MAN_A = [
".....HHHH.....",
"....HHHHHH....",
"....HHHHHH....",
"...GGHHHHGG...",
"....HHHHHH....",
".....HHHH.....",
"....WWWWWW....",
"...WWWTTWWW...",
"..WWWWTTWWWW..",
"..WWWWTTWWWW..",
".HWWWWTTWWWWH.",
".HWWWWTTWWWWH.",
"..WWWWWWWWWW..",
"..WWWWWWWWWW..",
"...WWWWWWWW...",
"...BBBBBBBB...",
"...BBBBBBBB...",
"...BBB..BBB...",
"...BBB..BBB...",
"...BBB..BBB...",
"...BBB..BBB...",
"...BBB..BBB...",
"...BBB..BBB...",
"...BBB..BBB...",
"...BBB..BBB...",
"...BBB..BBB...",
"..SSSS..SSSS..",
];
const MAN_B = [
".....HHHH.....",
"....HHHHHH....",
"....HHHHHH....",
"...GGHHHHGG...",
"....HHHHHH....",
".....HHHH.....",
"....WWWWWW....",
"...WWWTTWWW...",
"..WWWWTTWWWW..",
"..WWWWTTWWWW..",
".HWWWWTTWWWWH.",
".HWWWWTTWWWWH.",
"..WWWWWWWWWW..",
"..WWWWWWWWWW..",
"...WWWWWWWW...",
"...BBBBBBBB...",
"...BBBBBBBB...",
"..BBB....BBB..",
"..BBB....BBB..",
"..BBB....BBB..",
"..BBB....BBB..",
"..BBB....BBB..",
"..BBB....BBB..",
"..BBB....BBB..",
"..BBB....BBB..",
"..BBB....BBB..",
".SSSS....SSSS.",
];
const MAN_COLORS = {H: "#eab68f", G: "#3a3230", W: "#fdfdfb",
                    T: "#c0392b", B: "#4a4a48", S: "#2a2a28"};

// ------------------------------------------------------------ scene state
const canvas = document.getElementById("scene");
const context = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
let latestData = null;
let frame = 0;
const spotBySession = new Map();
// adoption ceremony state: new cats are carried in from the left, departed
// cats are carried out to the right; a cat stays hidden until delivered.
let adoptionRuns = [];
const hiddenCatIds = new Set();
let knownCatInfo = null;
// idle kittens free-roam and play fetch-with-themselves: whack the yarn ball,
// chase it, whack it again. kitten id → play state.
const kittenPlay = new Map();

function computeSpots(count) {
  // Cats spread evenly BOTH ways: a diagonal from upper-left to lower-right,
  // so each family owns its own vertical band for bubbles and kittens.
  const result = [];
  if (!count) return result;
  const lowLine = SCENE_H - 82;
  const stagger = 44;
  for (let i = 0; i < count; i++) {
    // one equal-width band per cat, cat centered in its band
    const centerX = Math.round(SCENE_W * (i + 0.5) / count);
    const treeY = count <= 2 ? lowLine
      : (i % 2 === 0 ? lowLine - stagger : lowLine);
    result.push({kind: "tree", x: centerX - 39, y: treeY, post: 52});
  }
  return result;
}

function assignSpots(sessions) {
  // Deterministic seating: order by a hash of the (stable) session UUID, so a
  // cat keeps its left-to-right position across page reloads and restarts.
  spotBySession.clear();
  const ordered = [...sessions].sort((a, b) =>
    seedFor(a.id) - seedFor(b.id) || a.id.localeCompare(b.id));
  ordered.forEach((session, index) => spotBySession.set(session.id, index));
}

function accentFor(sessionId) {
  // Color follows the cat, not its seat.
  return PALETTE[seedFor(sessionId) % PALETTE.length];
}

function sessionStatus(session, now) {
  const idle = now - session.modified_at;
  if (idle < 45) return "working";
  // A quiet transcript mid-tool-call (long Bash) or mid-generation is still work.
  if (session.awaiting === "tool" || session.awaiting === "model") return "working";
  if (idle < 300) return "thinking";
  // Waiting on background tasks (test runs, async agents): awake, not asleep.
  if (session.pending_tasks > 0) return "thinking";
  return "idle";
}

function sessionName(session) {
  if (session.parent_id) return session.title || session.id.replace(/^agent-/, "⑂ ");
  if (session.branch && session.branch !== "main" && session.branch !== "HEAD")
    return session.branch;
  if (session.title) return session.title;
  return session.project.split("/").pop() + " · " + session.id.slice(0, 6);
}

function lastEvent(session) {
  return session.events[session.events.length - 1] || null;
}

function kittensOf(data, sessionId) {
  return data.sessions.filter((s) => s.parent_id === sessionId);
}

// ------------------------------------------------------------ pixel helpers
function drawBitmap(rows, x, y, scale, colors) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const key = rows[r][c];
      if (key === ".") continue;
      context.fillStyle = colors[key];
      context.fillRect(x + c * scale, y + r * scale, scale, scale);
    }
  }
}

function rect(x, y, w, h, color) { context.fillStyle = color; context.fillRect(x, y, w, h); }

function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const dim = (v) => Math.max(0, Math.floor(v * 0.62));
  return "#" + [dim(n >> 16 & 255), dim(n >> 8 & 255), dim(n & 255)]
    .map((v) => v.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------ room & props
function drawRoom() {
  rect(0, 0, SCENE_W, WALL_H, "#f0d0ae");
  rect(0, 72, SCENE_W, 20, "#ddab80");
  for (let sx = 0; sx < SCENE_W; sx += 24) rect(sx, 74, 1, 18, "#cb9a70");
  rect(0, 72, SCENE_W, 2, "#b98a5e");
  for (let ty = WALL_H; ty < sceneH; ty += 18) {
    const plankRow = (ty - WALL_H) / 18;
    rect(0, ty, SCENE_W, 18, plankRow % 2 ? "#c09678" : "#c89e80");
    rect(0, ty, SCENE_W, 1, "#a87c62");
    for (let sx = (plankRow % 3) * 48; sx < SCENE_W; sx += 144)
      rect(sx, ty + 1, 1, 17, "#a87c62");
  }
}

function drawBunting() {
  rect(0, 2, SCENE_W, 2, "#b98a5e");
  const colors = ["#f2a0b8", "#a8d8c0", "#f7d64a", "#c3b2e2"];
  for (let i = 0; i < SCENE_W / 26; i++) {
    const color = colors[i % colors.length];
    const bx = i * 26 + 6;
    rect(bx, 4, 12, 4, color); rect(bx + 2, 8, 8, 3, color); rect(bx + 4, 11, 4, 3, color);
  }
}

function drawHangingPlant(x) {
  rect(x + 8, 0, 4, 6, "#8a5f3c");
  rect(x, 6, 20, 10, "#c47a52"); rect(x + 2, 14, 16, 3, "#a05f3e");
  const vines = [[x + 3, 40], [x + 9, 26], [x + 15, 34]];
  for (const [vx, length] of vines) {
    rect(vx, 17, 2, length, "#2f7d33");
    for (let ly = 20; ly < 17 + length; ly += 8) {
      rect(vx - 3, ly, 3, 4, "#4aa64e");
      rect(vx + 2, ly + 4, 3, 4, "#3c9440");
    }
  }
}

function drawCake(x, y, color, busy) {
  rect(x, y + 4, 18, 9, color);
  rect(x + 2, y, 14, 5, "#fff5ea");
  if (busy) {
    rect(x + 8, y - 4, 3, 4, frame % 2 ? "#ffd23e" : "#f28a3c");
    rect(x + 8, y - 6, 3, 2, "#fff5ea");
  } else {
    rect(x + 7, y - 3, 4, 4, "#e05a6a");
  }
}

const CASE = {x: 170, y: 16};
const CAKE_COLORS = ["#f2a0b8", "#a8d8a0", "#f7d64a", "#c3b2e2", "#f2b48a", "#a6dcf5"];
function drawCase(containers) {
  const {x, y} = CASE;
  rect(x - 4, y - 4, 128, 72, "#b98a5e");
  rect(x, y, 120, 62, "#faeedd");
  rect(x + 2, y + 26, 116, 3, "#d9bf9c");
  rect(x + 2, y + 52, 116, 3, "#d9bf9c");
  const slots = [[x + 10, y + 14], [x + 50, y + 14], [x + 90, y + 14],
                 [x + 10, y + 40], [x + 50, y + 40], [x + 90, y + 40]];
  slots.forEach(([cakeX, cakeY], index) => {
    const container = containers[index];
    if (container) drawCake(cakeX, cakeY, CAKE_COLORS[index], container.cpu >= 20);
  });
  rect(x + 6, y + 3, 3, 56, "rgba(255,255,255,0.55)");
  rect(x - 4, y + 62, 128, 10, "#8a5f3c");
}

const WINDOW = {x: 30, y: 16};
function drawWindow(load) {
  const {x, y} = WINDOW;
  const hot = load >= 70, warm = load >= 35;
  rect(x - 4, y - 4, 128, 68, "#b98a5e");
  rect(x, y, 120, 60, hot ? "#f7c791" : "#a6dcf5");
  const cx = x + 17, cy = y + 17;
  const radius = hot ? 12 : warm ? 9 : 7;
  const sunColor = hot ? "#ff9d2e" : warm ? "#f7c93e" : "#f2dc8a";
  rect(cx - radius, cy - radius, radius * 2, radius * 2, sunColor);
  rect(cx - radius + 3, cy - radius + 3, radius * 2 - 6, radius * 2 - 6,
    hot ? "#ffd23e" : "#f7e39a");
  if (warm) {
    const ray = (hot ? 8 : 5) + (hot && frame % 2 ? 3 : 0);
    rect(cx - radius - 3 - ray, cy - 1, ray, 2, sunColor);
    rect(cx + radius + 3, cy - 1, ray, 2, sunColor);
    rect(cx - 1, cy - radius - 3 - ray, 2, ray, sunColor);
    rect(cx - 1, cy + radius + 3, 2, ray, sunColor);
  }
  if (hot) {
    const diagonal = radius + 4 + (frame % 2 ? 2 : 0);
    rect(cx - diagonal - 2, cy - diagonal - 2, 3, 3, sunColor);
    rect(cx + diagonal, cy - diagonal - 2, 3, 3, sunColor);
    rect(cx - diagonal - 2, cy + diagonal, 3, 3, sunColor);
    rect(cx + diagonal, cy + diagonal, 3, 3, sunColor);
  }
  if (!warm) {
    rect(x + 40, y + 14, 22, 7, "#fdfdfb"); rect(x + 48, y + 10, 18, 6, "#fdfdfb");
    rect(x + 84, y + 22, 20, 7, "#fdfdfb"); rect(x + 92, y + 18, 14, 5, "#fdfdfb");
  }
  rect(x, y + 40, 120, 20, "#a8d8a0");
  rect(x + 58, y, 4, 60, "#b98a5e"); rect(x, y + 28, 120, 4, "#b98a5e");
}

const BOARD = {x: 330, y: 10, w: 240, h: 70};
function drawBoard() {
  rect(BOARD.x - 5, BOARD.y - 5, BOARD.w + 10, BOARD.h + 10, "#8a5f3c");
  rect(BOARD.x, BOARD.y, BOARD.w, BOARD.h, "#4e3a30");
  rect(BOARD.x + 8, BOARD.y + BOARD.h - 4, 20, 3, "#f2e4cf");
}

function drawWaterBowl(x, y) {
  rect(x, y, 24, 8, "#fffaf0"); rect(x + 2, y - 2, 20, 4, "#6db5e8");
  rect(x + 30, y, 24, 8, "#fffaf0"); rect(x + 2, y + 8, 52, 2, "#c9976e");
  rect(x + 33, y - 2, 18, 4, "#c47a52");
}

function drawYarn(x, y, color) {
  rect(x + 2, y, 8, 12, color); rect(x, y + 2, 12, 8, color);
  rect(x + 2, y + 4, 8, 1, shade(color)); rect(x + 4, y + 7, 8, 1, shade(color));
  rect(x + 10, y + 10, 14, 2, shade(color));
}

const KITTEN_YARN_COLORS = ["#e05a6a", "#9085e9", "#f7d64a", "#6db5e8"];

function advanceKittenPlay(play) {
  const minX = 24, maxX = SCENE_W - 24, minY = 135, maxY = sceneH - 18;
  play.ballX += play.ballVX;
  play.ballY += play.ballVY;
  play.ballVX *= 0.72;
  play.ballVY *= 0.72;
  if (Math.abs(play.ballVX) < 1) play.ballVX = 0;
  if (Math.abs(play.ballVY) < 1) play.ballVY = 0;
  if (play.ballX < minX) { play.ballX = minX; play.ballVX = Math.abs(play.ballVX); }
  if (play.ballX > maxX) { play.ballX = maxX; play.ballVX = -Math.abs(play.ballVX); }
  if (play.ballY < minY) { play.ballY = minY; play.ballVY = Math.abs(play.ballVY); }
  if (play.ballY > maxY) { play.ballY = maxY; play.ballVY = -Math.abs(play.ballVY); }
  const dx = play.ballX - play.x;
  const dy = play.ballY - play.y;
  const dist = Math.hypot(dx, dy) || 1;
  if (dist > 16) {
    const step = Math.min(9, dist);
    play.x += (dx / dist) * step;
    play.y += (dy / dist) * step;
    play.x = Math.min(maxX, Math.max(minX, play.x));
    play.y = Math.min(maxY, Math.max(minY, play.y));
  } else if (!play.ballVX && !play.ballVY) {
    const angle = Math.random() * Math.PI * 2;      // WHACK
    const power = 18 + Math.random() * 26;
    play.ballVX = Math.cos(angle) * power;
    play.ballVY = Math.sin(angle) * power * 0.5;
  }
}

function drawMiniYarn(x, y, color) {
  rect(x + 1, y, 6, 8, color); rect(x, y + 1, 8, 6, color);
  rect(x + 2, y + 3, 5, 1, shade(color));
  rect(x + 7, y + 5, 6, 2, shade(color));
}

const COFFEE = {x: 600, y: 26};
function drawCoffee(pct) {
  const {x, y} = COFFEE;
  const heat = pct == null ? 0 : pct;
  const busy = heat > 5;
  rect(x - 6, y + 32, 88, 6, "#b98a5e");                                 // shelf
  rect(x, y, 36, 30, "#b8b4ac"); rect(x - 2, y - 3, 40, 5, "#8f8b84");   // body
  rect(x + 6, y + 8, 24, 8, "#6a6660");                                  // band
  rect(x + 14, y + 18, 8, 6, "#8f8b84");                                 // group head
  rect(x + 30, y + 4, 4, 4,
    busy ? (frame % 2 ? "#e05a6a" : "#a04050") : "#5a5650");             // brew light
  rect(x + 12, y + 26, 12, 6, "#fff5ea");                                // cup
  if (busy && frame % 2)
    rect(x + 18, y + 24, 2, 3, "#6a4a30");                               // pour
  if (heat >= 25) {                                                      // steam
    const wave = frame % 2 ? 2 : 0;
    rect(x + 13 + wave, y - 9, 2, 5, "#efe8dc");
    rect(x + 22 - wave, y - 11, 2, 6, "#efe8dc");
    if (heat >= 60) rect(x + 5 + wave, y - 12, 2, 7, "#efe8dc");
  }
  rect(x + 48, y + 22, 10, 10, "#f2a0b8"); rect(x + 58, y + 25, 3, 4, "#f2a0b8");
  rect(x + 66, y + 22, 10, 10, "#a8d8c0"); rect(x + 76, y + 25, 3, 4, "#a8d8c0");
}

function drawPlant(x, y) {
  rect(x + 6, y + 14, 12, 12, "#c47a52"); rect(x + 8, y + 24, 8, 3, "#a05f3e");
  rect(x + 4, y + 2, 6, 12, "#2f7d33"); rect(x + 12, y, 6, 14, "#3c9440");
  rect(x + 9, y + 6, 5, 10, "#2f7d33");
  rect(x + 3, y, 4, 4, "#f2a0b8"); rect(x + 15, y - 3, 4, 4, "#e05a6a");
}

// ------------------------------------------------------------ spots & cats
function spotGeometry(spot) {
  const platformY = spot.y - spot.post - 14;
  return {catCenterX: spot.x + 39, catBottom: platformY + 10,
          nameX: spot.x + 39, nameY: spot.y + 14,
          laptopX: spot.x + 24, laptopY: platformY + 8};
}

function kittenPlacement(parentSlot, index) {
  // One kitten per vertical slot up the tree, alternating sides of the trunk:
  // slot 0 kitten-left, slot 1 kitten-right, … (its bubble takes the other side)
  const spot = spots[parentSlot];
  const geometry = spotGeometry(spot);
  const side = index % 2 === 0 ? -1 : 1;
  return {centerX: geometry.catCenterX + side * 56,
          bottom: spot.y + 6 - index * 30,
          side};
}

function kittenLabel(kitten) {
  const title = (kitten.title || "").trim();
  if (title && !/^you are /i.test(title)) return title;
  return "⑂ " + kitten.id.replace(/^agent-/, "").slice(0, 7);
}

function drawLaptop(x, y, accent, mode, pendingCount, flash) {
  if (mode === "closed") {
    rect(x, y - 4, 28, 4, "#3a3a38"); rect(x, y - 4, 28, 1, "#4c4c4a");
    return;
  }
  rect(x, y, 30, 3, "#3a3a38");
  rect(x + 3, y - 16, 24, 16, "#2a2a28");
  rect(x + 5, y - 14, 20, 12, mode === "lit" ? "#122633" : "#1c1c1b");
  if (mode === "lit") {
    rect(x + 3, y - 18, 24, 2, accent);
    for (let i = 0; i < 3; i++)
      rect(x + 7, y - 12 + i * 4, 5 + ((frame + i) % 3) * 4, 2, "#5598e7");
  } else if (mode === "spinner") {
    if (flash) {
      rect(x + 5, y - 14, 20, 12, "#3f9a55");
      return;
    }
    const centerX = x + 15, centerY = y - 8;
    for (let trail = 0; trail < 4; trail++) {
      const angle = (((frame * 2) - trail) % 8 + 8) % 8 / 8 * Math.PI * 2;
      rect(Math.round(centerX + Math.cos(angle) * 5) - 1,
           Math.round(centerY + Math.sin(angle) * 3) - 1, 2, 2,
           trail === 0 ? "#8fd0ff" : "#3d6f9e");
    }
    for (let dot = 0; dot < Math.min(5, pendingCount || 0); dot++)
      rect(x + 7 + dot * 4, y - 4, 2, 2, "#f7d64a");
  }
}

function drawTree(spot) {
  const platformY = spot.y - spot.post - 14;
  rect(spot.x + 6, spot.y, 66, 10, "#a5744a");
  rect(spot.x + 6, spot.y, 66, 2, "#bc8a60");
  rect(spot.x + 30, platformY + 14, 18, spot.post, "#d9b98c");
  for (let sy = platformY + 18; sy < spot.y - 2; sy += 8)
    rect(spot.x + 30, sy, 18, 2, "#c5a577");
  rect(spot.x, platformY, 78, 14, "#a5744a");
  rect(spot.x + 4, platformY + 2, 70, 6, "#ecd9b0");
}

function drawMan(x, feetY, carrying, accent) {
  const rows = frame % 2 ? MAN_B : MAN_A;
  drawBitmap(rows, x - 21, feetY - rows.length * 3, 3, MAN_COLORS);
  if (carrying)
    drawBitmap(CAT_SLEEP, x - 16, feetY - 74, 2,
      {S: accent, T: shade(accent), K: "#141412", P: "#f0937e", W: "#fffdf7"});
}

function drawAdoptionRuns() {
  // Departing cats wait asleep on their tree until the man collects them —
  // the tree only vanishes once the cat is in his arms.
  for (const waiting of adoptionRuns) {
    if (waiting.type === "depart" && waiting.phase === "in" && waiting.ghost) {
      drawTree(waiting.ghost.spot);
      const ghostGeometry = spotGeometry(waiting.ghost.spot);
      drawBitmap(Math.floor(frame / 3) % 2 ? CAT_SLEEP_BREATHE : CAT_SLEEP,
        ghostGeometry.catCenterX - 24,
        ghostGeometry.catBottom - CAT_SLEEP.length * 3, 3,
        {S: waiting.accent, T: shade(waiting.accent), K: "#141412",
         P: "#f0937e", W: "#fffdf7"});
    }
  }
  // There is only one adoption man; ceremonies queue and he handles them
  // one at a time. Queued arrivals stay hidden until he delivers them.
  const run = adoptionRuns[0];
  if (!run) return;
  const feetY = sceneH - 16;
  const speed = 20;
  if (run.x === null) run.x = run.type === "arrive" ? -40 : SCENE_W + 40;
  if (run.phase === "in") {
    run.x += run.type === "arrive" ? speed : -speed;
    const reached = run.type === "arrive" ? run.x >= run.targetX
                                          : run.x <= run.targetX;
    if (reached) {
      run.x = run.targetX;
      run.phase = "out";
      if (run.type === "arrive") hiddenCatIds.delete(run.id);
    }
  } else {
    run.x += run.type === "arrive" ? -speed : speed;
    if (run.x < -60 || run.x > SCENE_W + 60) {
      if (run.type === "arrive") hiddenCatIds.delete(run.id);
      adoptionRuns.shift();
      return;
    }
  }
  const carrying = run.type === "arrive" ? run.phase === "in"
                                         : run.phase === "out";
  drawMan(run.x, feetY, carrying, run.accent);
}

const BLINK_ROW_TOP = "..SSSSSSSSSSSS..";
const BLINK_ROW_BOTTOM = "..SKKKSSKKKSSS..";

// jolted awake: saucer eyes, fur spiked out in all directions
const CAT_STARTLED = [
"..S..S....S..S..",
"..SS.S....S.SS..",
"..SPSSSSSSSSPS..",
".SSSSSSSSSSSSSS.",
"S.SSSSSSSSSSSS.S",
"..SWWWSSWWWSSS..",
"..SWKWSSWKWSSS..",
"..SWWWSSWWWSSS..",
"..SSSSSPSSSSSS..",
"...SSSSSSSSSS...",
"..S.SSSSSSSS.S..",
".S.SSSSSSSSSS.S.",
"..SSSSSSSSSSS.SS",
".SSSSSSSSSSSS.SS",
"S.SSSSSSSSSSS.SS",
".SSSSS.SSSSSS.SS",
".SSSSS.SSSSSSSS.",
"..SSS...SSS.....",
];
const lastStatusById = new Map();
const startledUntil = new Map();
const previousPendingById = new Map();
const taskFlashUntil = new Map();

function seedFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function drawSpotWithCat(slot, session, now) {
  if (!session) return;
  const spot = spots[slot];
  const geometry = spotGeometry(spot);
  const accent = accentFor(session.id);
  const status = sessionStatus(session, now);
  drawTree(spot);
  if (hiddenCatIds.has(session.id)) return;  // still in the adoption man's arms
  const previousStatus = lastStatusById.get(session.id);
  if (previousStatus === "idle" && status !== "idle")
    startledUntil.set(session.id, frame + 5);
  lastStatusById.set(session.id, status);
  const startled = status !== "idle" && (startledUntil.get(session.id) || 0) > frame;
  // waiting = the laptop is grinding (long tool call or pending background
  // tasks) while the transcript is quiet — spinner time
  const idleAge = now - session.modified_at;
  const waiting = status !== "idle" && !startled &&
    ((session.awaiting === "tool" && idleAge >= 45) ||
     (session.awaiting === "user" && session.pending_tasks > 0));
  // raising a paw = a terminal wait-for-the-user state: an unanswered question,
  // or the turn ended on a message with nothing still running
  const raisingHand = status !== "idle" && !startled && !waiting &&
    (session.awaiting === "question" ||
     (session.awaiting === "user" && session.pending_tasks === 0));
  const previousPending = previousPendingById.get(session.id);
  if (previousPending !== undefined && session.pending_tasks < previousPending)
    taskFlashUntil.set(session.id, frame + 3);
  previousPendingById.set(session.id, session.pending_tasks);
  const seed = seedFor(session.id);
  let rows;
  if (status === "idle")
    rows = Math.floor(frame / 3) % 2 ? CAT_SLEEP_BREATHE : CAT_SLEEP;
  else if (startled) rows = CAT_STARTLED;
  else if (waiting) rows = CAT_SIT_A;                  // sitting with its coffee
  else if (raisingHand) rows = CAT_SIT_A;              // sitting, paw up (overlay)
  else if (status === "working") rows = frame % 2 ? CAT_SIT_B : CAT_SIT_A;
  else rows = Math.floor(frame / 3) % 2 ? CAT_SIT_B : CAT_SIT_A;
  if (status !== "idle" && !startled) {
    if ((frame + seed) % 13 === 0)                     // blink ~every 4s
      rows = rows.map((row, i) =>
        i === 5 ? BLINK_ROW_TOP : i === 6 ? BLINK_ROW_BOTTOM : row);
    if (!waiting && !raisingHand &&                     // never turn away while waiting
        Math.floor((frame + seed) / 26) % 2)
      rows = rows.map((row) => [...row].reverse().join(""));
  }
  const shake = startled ? (frame % 2 ? 2 : -2) : 0;
  const bob = status === "working" && !waiting && frame % 2 ? 1 : 0;
  drawBitmap(rows, geometry.catCenterX - 24 + shake,
    geometry.catBottom - rows.length * 3 + bob, 3,
    {S: accent, T: shade(accent), K: "#141412", P: "#f0937e", W: "#fffdf7"});
  if (startled) {
    const markX = geometry.catCenterX + 32;
    const markTop = geometry.catBottom - rows.length * 3 - 18;
    rect(markX, markTop, 4, 10, "#43302a");
    rect(markX, markTop + 13, 4, 4, "#43302a");
  }
  if (waiting) {
    // coffee break: mug held at the side, raised for a sip every so often
    const sipping = ((frame + seed + 10) % 20) < 2;
    const mugX = geometry.catCenterX + (sipping ? 6 : 16);
    const mugY = geometry.catBottom - (sipping ? 40 : 22);
    rect(mugX, mugY, 9, 8, "#fff5ea");
    rect(mugX + 9, mugY + 2, 3, 4, "#fff5ea");
    rect(mugX + 1, mugY + 1, 7, 2, "#6a4a30");
    if (frame % 2) {
      rect(mugX + 2, mugY - 5, 2, 3, "#efe8dc");
      rect(mugX + 5, mugY - 8, 2, 3, "#efe8dc");
    }
  }
  if (raisingHand) {
    // one front paw lifted and waving at shoulder height — "over here!"
    const spriteTop = geometry.catBottom - rows.length * 3;
    const up = Math.floor(frame / 2) % 2;
    const pawX = geometry.catCenterX - 32;
    const pawY = spriteTop + (up ? 14 : 22);
    rect(pawX + 7, pawY + 4, 9, 6, shade(accent));   // forearm to the body
    rect(pawX, pawY, 10, 9, accent);                 // paw
    rect(pawX + 2, pawY + 2, 5, 3, "#f0937e");       // toe beans
  }
  const laptopMode = waiting ? "spinner" :
    raisingHand ? "open" :
    status === "working" ? "lit" :
    status === "thinking" ? "open" : "closed";
  drawLaptop(geometry.laptopX, geometry.laptopY, accent, laptopMode,
    session.pending_tasks, (taskFlashUntil.get(session.id) || 0) > frame);
}

function drawScene() {
  context.clearRect(0, 0, SCENE_W, sceneH);
  const data = latestData;
  const latest = data && data.history.length
    ? data.history[data.history.length - 1] : null;
  const cpuLoad = latest && data.cpu_count
    ? (latest.total / data.cpu_count) * 100 : 0;
  drawRoom();
  drawWindow(cpuLoad);
  drawCase(data ? data.docker : []);
  drawBoard();
  drawBunting();
  drawHangingPlant(4);
  drawHangingPlant(699);
  drawWaterBowl(614, 330);
  drawCoffee(data ? data.gpu : null);
  drawYarn(206, 332, "#e66767");
  drawYarn(560, 324, "#9085e9");
  drawPlant(16, 106);
  const now = data ? data.generated_at : 0;
  const bySlot = new Map();
  if (data) for (const session of data.sessions) {
    const slot = spotBySession.get(session.id);
    if (slot !== undefined) bySlot.set(slot, session);
  }
  for (let slot = 0; slot < spots.length; slot++)
    drawSpotWithCat(slot, bySlot.get(slot) || null, now);
  if (data) for (const session of data.sessions) {
    const slot = spotBySession.get(session.id);
    if (slot === undefined || hiddenCatIds.has(session.id)) continue;
    const kittens = kittensOf(data, session.id);
    let workingSlot = 0;
    kittens.forEach((kitten, index) => {
      const accent = accentFor(session.id);
      const working = sessionStatus(kitten, now) === "working";
      const place = kittenPlacement(slot, working ? workingSlot++ : index);
      const kittenColors =
        {S: accent, T: shade(accent), K: "#141412", P: "#f0937e", W: "#fffdf7"};
      const yarnColor = KITTEN_YARN_COLORS[index % KITTEN_YARN_COLORS.length];
      if (working) {
        kittenPlay.delete(kitten.id);
        drawBitmap(KITTEN, place.centerX - 12,
          place.bottom - KITTEN.length * 3 + (frame % 2 ? 2 : 0), 3, kittenColors);
        const batted = ((frame + index) % 3) - 1;
        const hop = (frame + index) % 2 ? 2 : 0;
        drawMiniYarn(place.centerX - 4 + batted * 5, place.bottom - 4 - hop, yarnColor);
      } else {
        let play = kittenPlay.get(kitten.id);
        if (!play) {
          play = {x: place.centerX, y: place.bottom,
                  ballX: place.centerX + 22, ballY: place.bottom + 14,
                  ballVX: 0, ballVY: 0};
          kittenPlay.set(kitten.id, play);
        }
        advanceKittenPlay(play);
        drawMiniYarn(play.ballX - 4, play.ballY - 4, yarnColor);
        drawBitmap(KITTEN, play.x - 12,
          play.y - KITTEN.length * 3 + (frame % 2 ? 1 : 0), 3, kittenColors);
      }
    });
  }
  drawAdoptionRuns();
}

// ------------------------------------------------------------ overlays (DOM text)
function sceneScale() {
  const box = canvas.getBoundingClientRect();
  return Math.min(box.width / SCENE_W, box.height / sceneH);
}

function scenePosition(x, y) {
  const box = canvas.getBoundingClientRect();
  const scale = sceneScale();
  const offsetX = (box.width - SCENE_W * scale) / 2;
  const offsetY = (box.height - sceneH * scale) / 2;
  return {left: offsetX + x * scale, top: offsetY + y * scale};
}

function resolveBubbleCollisions() {
  // Kitten (mini) bubbles live in deterministic family slots — only free-floating
  // parent bubbles go through collision resolution.
  const bubbles = [...overlay.querySelectorAll(".bubble:not(.mini)")]
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  const placed = [...overlay.querySelectorAll(".nametag, .rack-label")]
    .map((nametag) => nametag.getBoundingClientRect());
  for (const bubble of bubbles) {
    const originalTop = parseFloat(bubble.style.top);
    let box = bubble.getBoundingClientRect();
    let guard = 0;
    let moved = true;
    while (moved && guard++ < 12) {
      moved = false;
      for (const other of placed) {
        const overlaps = box.left < other.right && box.right > other.left &&
          box.top < other.bottom && box.bottom > other.top;
        if (overlaps) {
          const delta = box.bottom - other.top + 5;
          bubble.style.top = (parseFloat(bubble.style.top) - delta) + "px";
          box = bubble.getBoundingClientRect();
          moved = true;
        }
      }
    }
    // A bubble must stay near its speaker: if dodging would detach it by more
    // than ~a bubble-height, keep it anchored and accept the small overlap.
    if (originalTop - parseFloat(bubble.style.top) > 44) {
      bubble.style.top = originalTop + "px";
      box = bubble.getBoundingClientRect();
    }
    placed.push(box);
  }
}

function bubbleHtml(event, status) {
  if (status === "idle") return `<span class="icon">\u{1F4A4}</span>zzz`;
  if (!event) return "";
  const icon = TOOL_ICONS[event.tool] || "⚙️";
  return `<span class="icon">${icon}</span>${escapeHtml(event.detail || event.tool)}`;
}

const BUBBLE_TTL_SECONDS = 180;
function bubbleContentFor(session, status, now) {
  if (status === "idle") return bubbleHtml(null, "idle");
  const event = lastEvent(session);
  if (!event) return "";
  const age = event.time ? now - Date.parse(event.time) / 1000 : Infinity;
  // a still-running tool call is live status, not staleness — never expire it
  if (session.awaiting !== "tool" && age > BUBBLE_TTL_SECONDS) return "";
  return bubbleHtml(event, status);
}

function ageLabel(seconds) {
  if (seconds < 60) return Math.max(0, Math.round(seconds)) + "s ago";
  if (seconds < 3600) return Math.round(seconds / 60) + "m ago";
  return (seconds / 3600).toFixed(1) + "h ago";
}

function hoverData(session, now) {
  const event = lastEvent(session);
  const pending = session.pending_tasks > 0
    ? `⏳ waiting on ${session.pending_tasks} background task` +
      `${session.pending_tasks === 1 ? "" : "s"} · ` : "";
  if (!event) return {message: pending + "no recent activity", when: ""};
  const icon = TOOL_ICONS[event.tool] || "⚙️";
  const age = event.time ? now - Date.parse(event.time) / 1000 : null;
  return {message: `${pending}${icon} ${event.detail || event.tool}`,
          when: age === null ? "" : ageLabel(age)};
}

function renderOverlay(data) {
  const now = data.generated_at;
  const scale = sceneScale();
  const bubbleFont = Math.max(9, Math.min(12, 11 * scale));
  // a bubble may fill at most its cat's equal share of the floor width
  const bandScreen = Math.round((SCENE_W / Math.max(1, spots.length)) * scale) - 12;
  const bubbleSize = `font-size:${bubbleFont.toFixed(1)}px;` +
    `max-width:${Math.max(90, Math.min(300, bandScreen))}px;`;
  const miniBubbleSize = `font-size:${bubbleFont.toFixed(1)}px;` +
    `max-width:${Math.max(80, Math.min(170, bandScreen))}px;`;
  const nameFont = `font-size:${Math.max(8, Math.min(12, 11 * scale)).toFixed(1)}px;`;
  const pieces = [];
  for (const session of data.sessions) {
    const slot = spotBySession.get(session.id);
    if (slot === undefined || hiddenCatIds.has(session.id)) continue;
    const spot = spots[slot];
    const geometry = spotGeometry(spot);
    const status = sessionStatus(session, now);
    const event = lastEvent(session);
    const catHeight = (status === "idle" ? CAT_SLEEP.length : CAT_SIT_A.length) * 3;
    const namePosition = scenePosition(geometry.nameX, geometry.nameY);
    const content = bubbleContentFor(session, status, now);
    // Family bubble stack: parent bubble at its head, kitten bubbles flowing
    // DOWNWARD in discrete one-line slots, alternating left/right columns.
    const stackAnchorY = geometry.catBottom - catHeight - 8;
    const parentPosition = scenePosition(geometry.catCenterX, stackAnchorY);
    if (content)
      pieces.push(`<div class="bubble ${status === "idle" ? "zzz" : ""}"` +
        ` style="left:${parentPosition.left}px;top:${parentPosition.top}px;${bubbleSize}">` +
        `${content}</div>`);
    const catHover = hoverData(session, now);
    const catBox = scenePosition(geometry.catCenterX - 26, geometry.catBottom - 58);
    const catBoxEnd = scenePosition(geometry.catCenterX + 26, geometry.catBottom + 4);
    pieces.push(`<div class="hover-target"` +
      ` style="left:${catBox.left}px;top:${catBox.top}px;` +
      `width:${catBoxEnd.left - catBox.left}px;height:${catBoxEnd.top - catBox.top}px"` +
      ` data-name="${escapeHtml(sessionName(session))}"` +
      ` data-when="${escapeHtml(catHover.when)}"` +
      ` data-message="${escapeHtml(catHover.message)}"></div>`);
    pieces.push(`<div class="nametag"` +
      ` style="left:${namePosition.left}px;top:${namePosition.top}px;${nameFont}">` +
      `${escapeHtml(sessionName(session))}` +
      (session.is_self ? ` <span class="side-badge">(this one)</span>` : "") + `</div>`);
    const kittens = kittensOf(data, session.id);
    let workingSlot = 0;
    kittens.forEach((kitten, index) => {
      const working = sessionStatus(kitten, now) === "working";
      const place = kittenPlacement(slot, working ? workingSlot++ : index);
      const play = kittenPlay.get(kitten.id);
      const kittenX = play ? play.x : place.centerX;
      const kittenY = play ? play.y : place.bottom;
      const kittenHover = hoverData(kitten, now);
      const hoverBox = scenePosition(kittenX - 14, kittenY - 24);
      const hoverBoxEnd = scenePosition(kittenX + 14, kittenY + 4);
      pieces.push(`<div class="hover-target"` +
        ` style="left:${hoverBox.left}px;top:${hoverBox.top}px;` +
        `width:${hoverBoxEnd.left - hoverBox.left}px;` +
        `height:${hoverBoxEnd.top - hoverBox.top}px"` +
        ` data-name="⑂ ${escapeHtml(kittenLabel(kitten))}"` +
        ` data-when="${escapeHtml(kittenHover.when)}"` +
        ` data-message="${escapeHtml(kittenHover.message)}"></div>`);
      if (!working) return;
      const kittenContent = bubbleContentFor(kitten, "working", now);
      if (kittenContent) {
        // speech hugs the kitten's inner shoulder, extending across the trunk
        const bubbleSide = -place.side;
        const anchor = scenePosition(place.centerX + bubbleSide * 16,
          place.bottom - 10);
        pieces.push(`<div class="bubble mini ` +
          `${bubbleSide > 0 ? "side-right" : "side-left"}"` +
          ` style="left:${anchor.left}px;top:${anchor.top}px;` +
          `${miniBubbleSize}">${kittenContent}</div>`);
      }
    });
  }
  // chalkboard: live commands
  const commands = data.trees.flatMap((tree) =>
    tree.rows.filter((row) => row.is_wrapper).map((row) => row.command));
  const boardTopLeft = scenePosition(BOARD.x + 6, BOARD.y + 5);
  const boardBottomRight = scenePosition(BOARD.x + BOARD.w - 6, BOARD.y + BOARD.h - 5);
  const boardWidth = boardBottomRight.left - boardTopLeft.left;
  const fontPx = Math.max(8, Math.round(boardWidth / 34));
  pieces.push(`<div class="board-text" style="left:${boardTopLeft.left}px;` +
    `top:${boardTopLeft.top}px;width:${boardWidth}px;` +
    `height:${boardBottomRight.top - boardTopLeft.top}px;font-size:${fontPx}px">` +
    `<div class="board-title">TODAY'S SPECIALS (${commands.length})</div>` +
    commands.slice(0, 4).map((c) => `<div>▸ ${escapeHtml(c)}</div>`).join("") +
    `</div>`);
  if (!data.sessions.length)
    pieces.push(`<div class="empty-office">The cafe is empty — no cats working` +
      ` in the last 15 minutes.</div>`);
  overlay.innerHTML = pieces.join("");
  clampBubblesToView();
  resolveBubbleCollisions();
}

function clampBubblesToView() {
  const viewWidth = overlay.clientWidth;
  for (const bubble of overlay.querySelectorAll(".bubble")) {
    const box = bubble.getBoundingClientRect();
    if (box.left < 2)
      bubble.style.left = (parseFloat(bubble.style.left) + (2 - box.left)) + "px";
    else if (box.right > viewWidth - 2)
      bubble.style.left =
        (parseFloat(bubble.style.left) - (box.right - viewWidth + 2)) + "px";
  }
}

// ------------------------------------------------------------ main loops
function renderCorner(data) {
  const latest = data.history[data.history.length - 1] || {claude: 0, docker: 0};
  const cats = data.sessions.filter((s) => !s.parent_id).length;
  const kittens = data.sessions.length - cats;
  const kittenPart = kittens ? ` · ${kittens} kitten${kittens > 1 ? "s" : ""}` : "";
  document.getElementById("corner-text").textContent =
    `${cats} cat${cats === 1 ? "" : "s"}${kittenPart}` +
    ` · claude ${latest.claude.toFixed(1)}c · docker ${latest.docker.toFixed(1)}c` +
    ` · gpu ${data.gpu == null ? "–" : data.gpu + "%"}` +
    ` · ${new Date().toLocaleTimeString()}`;
}

function postForKittens(kittenCount) {
  // One kitten slot per level, so the post grows with the litter — capped so
  // the platform never crowds the wall labels.
  return Math.min(116, 52 + 30 * Math.max(0, kittenCount - 1));
}

function trackAdoptions(cats) {
  const currentInfo = new Map();
  for (const cat of cats) {
    const slot = spotBySession.get(cat.id);
    if (slot === undefined || !spots[slot]) continue;
    currentInfo.set(cat.id, {x: spotGeometry(spots[slot]).catCenterX,
                             accent: accentFor(cat.id),
                             spot: {...spots[slot]}});
  }
  if (knownCatInfo === null) { knownCatInfo = currentInfo; return; }
  for (const [id, info] of currentInfo) {
    if (!knownCatInfo.has(id)) {
      hiddenCatIds.add(id);
      adoptionRuns.push({type: "arrive", id, phase: "in", accent: info.accent,
                         x: null, targetX: info.x});
    }
  }
  for (const [id, info] of knownCatInfo) {
    if (!currentInfo.has(id))
      adoptionRuns.push({type: "depart", id, phase: "in", accent: info.accent,
                         x: null, targetX: info.x,
                         ghost: info.spot ? {spot: info.spot} : null});
  }
  // layout may shift while a delivery is in flight — keep target current
  for (const run of adoptionRuns)
    if (run.type === "arrive" && currentInfo.has(run.id))
      run.targetX = currentInfo.get(run.id).x;
  knownCatInfo = currentInfo;
}

function apply(data) {
  const cats = data.sessions.filter((s) => !s.parent_id);
  // Freeze the layout while a departure is pending (or detected this cycle):
  // the man collects the cat from the arrangement as-it-was; the remaining
  // trees only re-spread once the ceremony is over.
  const liveIds = new Set(cats.map((cat) => cat.id));
  const departureDetected = knownCatInfo !== null &&
    [...knownCatInfo.keys()].some((id) => !liveIds.has(id));
  const departurePending = adoptionRuns.some((run) => run.type === "depart");
  if (!departureDetected && !departurePending) {
    spots = computeSpots(cats.length);
    assignSpots(cats);
  }
  for (const [sessionId, slot] of spotBySession)
    if (spots[slot]) {
      const workingKittens = kittensOf(data, sessionId).filter((kitten) =>
        sessionStatus(kitten, data.generated_at) === "working").length;
      spots[slot].post = postForKittens(workingKittens);
    }
  trackAdoptions(cats);
  const kittenIds = new Set(
    data.sessions.filter((s) => s.parent_id).map((s) => s.id));
  for (const id of [...kittenPlay.keys()])
    if (!kittenIds.has(id)) kittenPlay.delete(id);
  latestData = data;
  renderOverlay(data);
  renderCorner(data);
}

let lastFetchOk = 0;
let serverVersion = null;
let refreshInFlight = false;
let refreshStartedAt = 0;
let lastClientLogAt = 0;
let pushCount = 0;

function clientLog(message) {
  try { navigator.sendBeacon("/client-log", message); } catch (error) {}
}

function consume(data, source) {
  if (serverVersion === null) serverVersion = data.server_started;
  else if (data.server_started !== serverVersion) {
    clientLog(`server version changed — reloading (via ${source})`);
    location.reload();
    return;
  }
  try {
    apply(data);
  } catch (renderError) {
    // Visible degradation: a broken render must never look like a healthy pause.
    document.getElementById("corner").classList.add("stale");
    document.getElementById("corner-text").textContent =
      "render error: " + (renderError.message || renderError);
    clientLog(`render error via ${source}: ${renderError.message || renderError}`);
    return;
  }
  lastFetchOk = Date.now();
  document.getElementById("corner").classList.remove("stale");
  if (Date.now() - lastClientLogAt > 30000) {
    lastClientLogAt = Date.now();
    clientLog(`heartbeat via ${source} · pushes=${pushCount}` +
      ` · hidden=${document.hidden} · lag ok`);
  }
}

// Primary data path inside VS Code: the extension host pushes /data snapshots
// via postMessage (relayed by the wrapper). Message delivery is not throttled
// like timers/rAF, so this keeps working even when Chromium suspends the iframe.
window.addEventListener("message", (event) => {
  const message = event.data;
  if (message && message.type === "catCafeData" && message.data) {
    pushCount++;
    if (pushCount === 1) clientLog("push path active (extension host feed)");
    consume(message.data, "push");
    frame++;
    drawScene();
  }
});

async function refresh() {
  if (refreshInFlight && Date.now() - refreshStartedAt < 5000) return;
  if (refreshInFlight) clientLog("stale in-flight fetch lock overridden");
  refreshInFlight = true;
  refreshStartedAt = Date.now();
  try {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 2500);
    const response = await fetch("/data", {cache: "no-store", signal: controller.signal});
    clearTimeout(abortTimer);
    const data = await response.json();
    consume(data, "fetch");
  } catch (error) {
    if (Date.now() - lastFetchOk > 6000) {
      document.getElementById("corner").classList.add("stale");
      document.getElementById("corner-text").textContent = "disconnected";
      clientLog(`fetch failing: ${error.name || error}`);
    }
  } finally {
    refreshInFlight = false;
  }
}

document.addEventListener("visibilitychange", () => {
  clientLog(`visibility → ${document.hidden ? "hidden" : "visible"}`);
});
clientLog(`page boot · ${navigator.userAgent.split(") ")[0]})`);

const BOOTSTRAP = "__BOOTSTRAP__";
window.addEventListener("resize", () => { if (latestData) renderOverlay(latestData); });
if (typeof BOOTSTRAP === "object" && BOOTSTRAP) apply(BOOTSTRAP);
drawScene();
refresh();

// Drive animation and polling from requestAnimationFrame, not setInterval:
// Chromium throttles interval timers in webview iframes (sometimes to minutes),
// but rAF always runs while the page is actually visible.
let lastFrameAt = 0;
let lastRefreshAt = 0;
function pump(now) {
  if (now - lastFrameAt >= 320) { lastFrameAt = now; frame++; drawScene(); }
  if (now - lastRefreshAt >= 1000) { lastRefreshAt = now; refresh(); }
  requestAnimationFrame(pump);
}
requestAnimationFrame(pump);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
// Low-frequency backstop in case rAF is ever suspended while still visible.
setInterval(refresh, 10000);

// Hover a cat or kitten to see its full last message.
const hovercard = document.getElementById("hovercard");
overlay.addEventListener("mouseover", (event) => {
  const target = event.target.closest(".hover-target");
  if (!target) return;
  hovercard.innerHTML =
    `<span class="who">${escapeHtml(target.dataset.name)}</span>` +
    `<span class="when">${escapeHtml(target.dataset.when)}</span><br>` +
    `${escapeHtml(target.dataset.message)}`;
  const box = target.getBoundingClientRect();
  hovercard.style.display = "block";
  const cardWidth = 330;
  hovercard.style.left =
    Math.max(8, Math.min(window.innerWidth - cardWidth - 8, box.left)) + "px";
  hovercard.style.top = Math.max(8, box.top - hovercard.offsetHeight - 8) + "px";
});
overlay.addEventListener("mouseout", (event) => {
  if (event.target.closest(".hover-target")) hovercard.style.display = "none";
});
</script>
</body>
</html>
"""


def main() -> None:
    global DEMO_MODE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--demo", action="store_true",
                        help="serve a fixed synthetic scene (for previews); "
                             "samples no real processes, docker, or transcripts")
    arguments = parser.parse_args()
    DEMO_MODE = arguments.demo
    if not DEMO_MODE:
        for sample_function, interval in (
            (sample_processes, PROCESS_SAMPLE_SECONDS),
            (sample_docker, DOCKER_SAMPLE_SECONDS),
            (sample_sessions, SESSION_SAMPLE_SECONDS),
            (sample_gpu, GPU_SAMPLE_SECONDS),
        ):
            thread = threading.Thread(
                target=run_sampler, args=(sample_function, interval), daemon=True)
            thread.start()
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), DashboardHandler)
    print(f"Nekomata{' (demo)' if DEMO_MODE else ''}: "
          f"http://localhost:{arguments.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
