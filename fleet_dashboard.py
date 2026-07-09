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


CONTINUATION_PREFIX = "This session is being continued"


def session_title(head_entries: list[dict], tail_entries: list[dict]) -> str:
    # Claude Code's generated display name is the cleanest label for a session.
    # It's (re)written as the conversation evolves, so the freshest copy is in
    # the tail; fall back to the head for short sessions.
    for entry in reversed(tail_entries):
        if entry.get("type") == "ai-title" and entry.get("aiTitle"):
            return entry["aiTitle"].strip()
    for entry in head_entries:
        if entry.get("type") == "ai-title" and entry.get("aiTitle"):
            return entry["aiTitle"].strip()
    for entry in head_entries:
        if entry.get("type") == "summary" and entry.get("summary"):
            return entry["summary"].strip()
    for entry in head_entries:
        if entry.get("type") == "user" and isinstance(entry.get("message"), dict):
            text = extract_text_content(entry["message"]).strip()
            # skip XML/system framing and compaction "continued from…" blurbs
            if text and not text.startswith("<") \
                    and not text.startswith(CONTINUATION_PREFIX):
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
        "title": session_title(head_entries, tail_entries),
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
        # a stub (only ai-title / agent-name metadata, no timestamped messages)
        # is a not-yet-started session, not a live cat
        "has_activity": last_activity is not None,
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
                if not session["has_activity"]:
                    continue  # session stub with no real conversation yet
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


WEB_DIR = Path(__file__).resolve().parent / "web"


def load_page_html() -> str:
    """Assemble the single self-contained page from the split web/ sources."""
    index = (WEB_DIR / "index.html").read_text(encoding="utf-8")
    styles = (WEB_DIR / "styles.css").read_text(encoding="utf-8")
    app = (WEB_DIR / "app.js").read_text(encoding="utf-8")
    return index.replace("/*__STYLES__*/", styles).replace("/*__APP__*/", app)


PAGE_HTML = load_page_html()


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
