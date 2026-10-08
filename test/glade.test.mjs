// Tests for the Glade adapter (web/glade.js) and the plugin build (glade/build.mjs).
// Run with `node --test`. No dependencies: Node's own test runner and assert.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { build, manifest, page, styles, themes } from "../glade/build.mjs";

const require = createRequire(import.meta.url);
const {
  createModel, statusText, connect, formatBytes, KITTEN_LINGER_MS, CAT_IDLE_WINDOW_MS, MAX_MACHINE_HISTORY,
} = require("../web/glade.js");

// ------------------------------------------------------------------ fixtures
const NOW = Date.parse("2026-09-25T10:00:00Z");
const NOW_S = NOW / 1000;

function task(id, fields = {}) {
  return {
    id, workspaceId: "ws-1", workspaceName: "acme-api", title: `Task ${id}`, status: "",
    state: "active", activity: "waiting", needsYou: false, waitingOn: null,
    createdAt: NOW - 60_000, updatedAt: NOW - 60_000, doneAt: null, ...fields,
  };
}

function subagent(id, taskId, fields = {}) {
  return {
    id, taskId, name: `Subagent ${id}`, state: "running", latest: null,
    startedAt: NOW - 30_000, endedAt: null, ...fields,
  };
}

function call(id, taskId, fields = {}) {
  return {
    id, taskId, subagentId: null, tool: "Read", summary: "api/views.py", state: "running",
    startedAt: NOW - 5_000, endedAt: null, ...fields,
  };
}

function snapshot(fields = {}) {
  return { type: "snapshot", tasks: [], subagents: [], questions: [], permissions: [], ...fields };
}

const question = (taskId, questionSetId) =>
  ({ taskId, questionSetId, prompts: ["Which limit for /search?"], openedAt: NOW });
const permission = (taskId, requestId, subagentId = null) =>
  ({ taskId, requestId, subagentId, tool: "Bash", summary: "rm -rf build", openedAt: NOW });

/** A model fed `events` in order. */
function fed(...events) {
  const model = createModel();
  for (const event of events) model.handle(event);
  return model;
}

const sessionsOf = (model, now = NOW) => model.scene(now).sessions;
const cats = (model, now) => sessionsOf(model, now).filter((s) => !s.parent_id);
const kittens = (model, now) => sessionsOf(model, now).filter((s) => s.parent_id);
const cat = (model, id, now) => cats(model, now).find((s) => s.id === id);
const kitten = (model, id, now) => kittens(model, now).find((s) => s.id === id);

// app.js's sessionStatus and pose rules, restated so the tests read as what the
// scene shows. Keep in step with drawSpotWithCat() in web/app.js.
function pose(session, nowSeconds = NOW_S) {
  const idle = nowSeconds - session.modified_at;
  let status = "idle";
  if (idle < 45 || session.awaiting === "tool" || session.awaiting === "model") status = "working";
  else if (idle < 300 || session.pending_tasks > 0) status = "thinking";
  if (status === "idle") return "asleep";
  const coffee = (session.awaiting === "tool" && idle >= 45) ||
    (session.awaiting === "user" && session.pending_tasks > 0);
  if (coffee) return "coffee";
  if (session.awaiting === "question" || (session.awaiting === "user" && session.pending_tasks === 0))
    return "paw";
  return status === "working" ? "typing" : "awake";
}

// ------------------------------------------------------------------ mapping
describe("snapshot", () => {
  test("a cat per active task and a kitten per running subagent, under its task", () => {
    const model = fed(snapshot({
      tasks: [task("t1", { activity: "working" }), task("t2"), task("t3", { state: "done" })],
      subagents: [subagent("s1", "t1"), subagent("s2", "t1"), subagent("s9", "gone")],
    }));
    assert.deepEqual(cats(model).map((s) => s.id).sort(), ["t1", "t2"]);
    assert.deepEqual(kittens(model).map((s) => [s.id, s.parent_id]), [["s1", "t1"], ["s2", "t1"]]);
    assert.equal(kitten(model, "s1").title, "Subagent s1");
    assert.equal(pose(kitten(model, "s1")), "typing");
  });

  test("a cat is named by its task's title, or Glade's own name for an untitled one", () => {
    const model = fed(snapshot({ tasks: [task("t1", { title: "" }), task("t2", { title: "Fix flaky login" })] }));
    assert.equal(cat(model, "t1").title, "acme-api · New task");
    assert.equal(cat(model, "t2").title, "acme-api · Fix flaky login");
    assert.equal(cat(model, "t1").project, "acme-api");
    assert.equal(cat(model, "t1").branch, "");
  });

  test("without the machine capability, the room's machine readings stay empty", () => {
    const data = fed(snapshot({ tasks: [task("t1")] })).scene(NOW);
    assert.equal(data.cpu_count, 0);
    assert.equal(data.gpu, null);
    assert.deepEqual(data.docker, []);
    assert.deepEqual(data.history, []);
    assert.equal(data.generated_at, NOW_S);
  });

  test("questions and permission cards in the snapshot raise their cats' paws", () => {
    const model = fed(snapshot({
      tasks: [task("t1"), task("t2"), task("t3")],
      questions: [question("t1", "q1"), question("gone", "q9")],
      permissions: [permission("t2", "p1")],
    }));
    assert.equal(pose(cat(model, "t1")), "paw");
    assert.equal(pose(cat(model, "t2")), "paw");
    assert.equal(pose(cat(model, "t3")), "asleep");
  });
});

// A machine reading as Glade sends it with the `machine` capability on.
function reading(t, fields = {}) {
  return {
    t, cpuCount: 10, total: 7.3, claude: 4.6, docker: 1.24, gpu: 88,
    containers: [
      { name: "acme-api-db-1", cpu: 78, memory: 440_401_920 },
      { name: "acme-api-web-1", cpu: 46, memory: 188_743_680 },
    ],
    ...fields,
  };
}

describe("the machine: window, pastry case and espresso machine", () => {
  test("a snapshot's readings fill cpu_count, gpu, docker and history as fleet_dashboard.py serves them", () => {
    const data = fed(snapshot({ machine: [reading(NOW - 2_000, { total: 5 }), reading(NOW)] })).scene(NOW);
    assert.equal(data.cpu_count, 10);
    assert.equal(data.gpu, 88);
    assert.deepEqual(data.docker, [
      { name: "acme-api-db-1", status: "", cpu: 78, memory: "420MiB" },
      { name: "acme-api-web-1", status: "", cpu: 46, memory: "180MiB" },
    ]);
    assert.deepEqual(data.history, [
      { t: NOW_S - 2, claude: 4.6, docker: 1.24, total: 5 },
      { t: NOW_S, claude: 4.6, docker: 1.24, total: 7.3 },
    ]);
  });

  test("app.js's window load and cakes come out as on the dashboard", () => {
    const data = fed(snapshot({ machine: [reading(NOW)] })).scene(NOW);
    // drawScene(): the window's load is the latest total over the core count
    const latest = data.history[data.history.length - 1];
    assert.equal((latest.total / data.cpu_count) * 100, 73);
    // drawCase(): a steaming cake per busy container
    assert.deepEqual(data.docker.map((container) => container.cpu >= 20), [true, true]);
  });

  test("each machine.reading adds to the history, and the latest sets the rest", () => {
    const model = fed(snapshot({ machine: [] }));
    assert.equal(model.handle({ type: "machine.reading", reading: reading(NOW - 2_000) }), true);
    assert.equal(model.handle({ type: "machine.reading", reading: reading(NOW, { gpu: null, containers: [] }) }), true);
    const data = model.scene(NOW);
    assert.equal(data.history.length, 2);
    assert.equal(data.gpu, null);
    assert.deepEqual(data.docker, []);
  });

  test("keeps the latest 60, as Glade's snapshot does", () => {
    const model = fed(snapshot({ machine: Array.from({ length: 70 }, (_, i) => reading(NOW + i)) }));
    assert.equal(model.scene(NOW).history.length, MAX_MACHINE_HISTORY);
    assert.equal(model.scene(NOW).history[0].t, (NOW + 10) / 1000);
    for (let i = 0; i < 5; i += 1) model.handle({ type: "machine.reading", reading: reading(NOW + 100 + i) });
    assert.equal(model.scene(NOW).history.length, MAX_MACHINE_HISTORY);
    assert.equal(model.scene(NOW).history.at(-1).t, (NOW + 104) / 1000);
  });

  test("a new snapshot without machine readings (the capability turned off) quiets the room again", () => {
    const model = fed(snapshot({ machine: [reading(NOW)] }));
    model.handle({ type: "machine.reading", reading: reading(NOW + 2_000) });
    model.handle(snapshot());
    const data = model.scene(NOW);
    assert.equal(data.cpu_count, 0);
    assert.equal(data.gpu, null);
    assert.deepEqual(data.docker, []);
    assert.deepEqual(data.history, []);
  });

  test("drops a reading it can't use, without re-rendering", () => {
    const model = fed(snapshot({ machine: [reading(NOW), { t: NOW }, null, "busy"] }));
    assert.equal(model.scene(NOW).history.length, 1);
    assert.equal(model.handle({ type: "machine.reading", reading: { total: "lots" } }), false);
    assert.equal(model.handle({ type: "machine.reading" }), false);
    assert.equal(model.scene(NOW).history.length, 1);
  });

  test("reads odd container fields safely", () => {
    const data = fed(snapshot({
      machine: [reading(NOW, { containers: [{ name: 7, cpu: "x", memory: undefined }] }), reading(NOW, { containers: "none" })],
    })).scene(NOW);
    assert.deepEqual(data.docker, []);
    const odd = fed(snapshot({ machine: [reading(NOW, { containers: [{ name: 7, cpu: "x" }], claude: undefined })] }));
    assert.deepEqual(odd.scene(NOW).docker, [{ name: "7", status: "", cpu: 0, memory: "0B" }]);
    assert.equal(odd.scene(NOW).history[0].claude, 0);
  });

  test("formatBytes words memory as docker stats does", () => {
    assert.equal(formatBytes(0), "0B");
    assert.equal(formatBytes(512), "512B");
    assert.equal(formatBytes(1536), "1.5KiB");
    assert.equal(formatBytes(440_401_920), "420MiB");
    assert.equal(formatBytes(1_181_116_006), "1.1GiB");
    assert.equal(formatBytes(5 * 1024 ** 5), "5120TiB");
  });
});

describe("tasks", () => {
  test("task.created brings a new cat, asleep until it works", () => {
    const model = fed(snapshot(), { type: "task.created", task: task("t1", { title: "" }) });
    assert.equal(cat(model, "t1").title, "acme-api · New task");
    assert.equal(pose(cat(model, "t1")), "asleep");
  });

  test("task.updated sets what the cat is doing", () => {
    const model = fed(snapshot({ tasks: [task("t1")] }));
    const poseAfter = (fields) => {
      model.handle({ type: "task.updated", task: task("t1", fields) });
      return pose(cat(model, "t1"));
    };
    assert.equal(poseAfter({ activity: "working" }), "typing");
    assert.equal(poseAfter({ activity: "working", waitingOn: "question" }), "paw");
    assert.equal(poseAfter({ activity: "working", waitingOn: "permission" }), "paw");
    assert.equal(poseAfter({ activity: "paused" }), "coffee");
    assert.equal(poseAfter({ activity: "error" }), "asleep");
    assert.equal(poseAfter({ activity: "waiting" }), "asleep");
    assert.equal(poseAfter({ title: "Renamed" }), "asleep");
    assert.equal(cat(model, "t1").title, "acme-api · Renamed");
  });

  test("an update for a task it doesn't know is a new task (reopened, or a follow-up)", () => {
    const model = fed(snapshot({ tasks: [task("t1")] }),
      { type: "task.updated", task: task("t2", { activity: "working" }) });
    assert.deepEqual(cats(model).map((s) => s.id).sort(), ["t1", "t2"]);
    assert.equal(pose(cat(model, "t2")), "typing");
  });

  test("an update to done for a task it doesn't know changes nothing", () => {
    const model = fed(snapshot({ tasks: [task("t1")] }),
      { type: "task.updated", task: task("t2", { state: "done" }) });
    assert.deepEqual(cats(model).map((s) => s.id), ["t1"]);
  });

  test("marking a task done carries its cat out, with its kittens and raised paw", () => {
    const model = fed(
      snapshot({ tasks: [task("t1"), task("t2")], subagents: [subagent("s1", "t1")],
        questions: [question("t1", "q1")] }),
      { type: "task.updated", task: task("t1", { state: "done", doneAt: NOW }) },
    );
    assert.deepEqual(sessionsOf(model).map((s) => s.id), ["t2"]);
    // reopened: a fresh cat, without the old question
    model.handle({ type: "task.updated", task: task("t1") });
    assert.equal(pose(cat(model, "t1")), "asleep");
    assert.equal(kittens(model).length, 0);
  });

  test("a task deleted mid-turn leaves, and its late events don't bring it back", () => {
    const model = fed(
      snapshot({ tasks: [task("t1", { activity: "working" })], subagents: [subagent("s1", "t1")] }),
      { type: "agent.toolCall", call: call("c1", "t1") },
      { type: "task.deleted", taskId: "t1" },
    );
    assert.deepEqual(sessionsOf(model), []);
    for (const event of [
      { type: "agent.toolCall", call: call("c1", "t1", { state: "interrupted", endedAt: NOW }) },
      { type: "agent.toolCall", call: call("c2", "t1", { subagentId: "s1" }) },
      { type: "agent.note", taskId: "t1", subagentId: null, text: "Still here?", at: NOW },
      { type: "subagent.updated", subagent: subagent("s1", "t1", { state: "stopped", endedAt: NOW }) },
      { type: "subagent.started", subagent: subagent("s2", "t1") },
      { type: "question.opened", question: question("t1", "q1") },
      { type: "permission.opened", request: permission("t1", "p1") },
    ]) assert.equal(model.handle(event), false, event.type);
    assert.deepEqual(sessionsOf(model), []);
    assert.deepEqual(model.scene(NOW).trees[0].rows, []);
  });
});

describe("tool calls and notes: the speech bubbles", () => {
  test("a call shows in its cat's bubble, and its end replaces its start", () => {
    const model = fed(snapshot({ tasks: [task("t1", { activity: "working" })] }),
      { type: "agent.toolCall", call: call("c1", "t1", { tool: "Edit", summary: "api/throttles.py" }) });
    assert.deepEqual(cat(model, "t1").events,
      [{ time: new Date(NOW - 5_000).toISOString(), tool: "Edit", detail: "api/throttles.py" }]);
    assert.equal(cat(model, "t1").awaiting, "tool");
    model.handle({ type: "agent.toolCall",
      call: call("c1", "t1", { tool: "Edit", summary: "api/throttles.py", state: "done", endedAt: NOW }) });
    assert.equal(cat(model, "t1").events.length, 1);
    assert.equal(cat(model, "t1").awaiting, "model");
    assert.equal(pose(cat(model, "t1")), "typing");
  });

  test("a long-running call turns into a coffee break", () => {
    const model = fed(snapshot({ tasks: [task("t1", { activity: "working" })] }),
      { type: "agent.toolCall", call: call("c1", "t1", { tool: "Bash", summary: "make test", startedAt: NOW - 90_000 }) });
    assert.equal(pose(cat(model, "t1")), "coffee");
  });

  test("notes are said, in order after the calls", () => {
    const model = fed(snapshot({ tasks: [task("t1", { activity: "working" })] }),
      { type: "agent.toolCall", call: call("c1", "t1", { state: "done", endedAt: NOW - 2_000 }) },
      { type: "agent.note", taskId: "t1", subagentId: null, text: "Tests pass.", at: NOW - 1_000 });
    const events = cat(model, "t1").events;
    assert.deepEqual(events.at(-1), { time: new Date(NOW - 1_000).toISOString(), tool: "say", detail: "Tests pass." });
    assert.equal(events.length, 2);
  });

  test("a subagent's calls and notes are its kitten's, not its cat's", () => {
    const model = fed(snapshot({ tasks: [task("t1", { activity: "working" })], subagents: [subagent("s1", "t1")] }),
      { type: "agent.toolCall", call: call("c1", "t1", { subagentId: "s1", tool: "Grep", summary: "throttle" }) },
      { type: "agent.note", taskId: "t1", subagentId: "s1", text: "Found it.", at: NOW });
    assert.deepEqual(cat(model, "t1").events, []);
    assert.deepEqual(kitten(model, "s1").events.map((e) => e.detail), ["throttle", "Found it."]);
    assert.equal(kitten(model, "s1").awaiting, "tool");
  });

  test("before its first call or note, a cat says its task's status line", () => {
    const model = fed(snapshot({ tasks: [task("t1", { activity: "working", status: "Copying files, 1,240 of 3,900" })] }));
    assert.deepEqual(cat(model, "t1").events,
      [{ time: new Date(NOW).toISOString(), tool: "say", detail: "Copying files, 1,240 of 3,900" }]);
    model.handle({ type: "agent.toolCall", call: call("c1", "t1", { tool: "Bash", summary: "aws s3 sync" }) });
    assert.deepEqual(cat(model, "t1").events.map((e) => e.detail), ["aws s3 sync"]);
  });

  test("a bubble keeps its session's latest 20", () => {
    const model = fed(snapshot({ tasks: [task("t1", { activity: "working" })] }));
    for (let i = 0; i < 30; i++)
      model.handle({ type: "agent.note", taskId: "t1", subagentId: null, text: `note ${i}`, at: NOW + i });
    const events = cat(model, "t1").events;
    assert.equal(events.length, 20);
    assert.equal(events[0].detail, "note 10");
    assert.equal(events.at(-1).detail, "note 29");
  });

  test("running Bash commands are the chalkboard's specials", () => {
    const model = fed(snapshot({ tasks: [task("t1", { activity: "working" })], subagents: [subagent("s1", "t1")] }),
      { type: "agent.toolCall", call: call("c1", "t1", { tool: "Bash", summary: "pytest api/tests -q" }) },
      { type: "agent.toolCall", call: call("c2", "t1", { tool: "Bash", summary: "npm run lint", subagentId: "s1" }) },
      { type: "agent.toolCall", call: call("c3", "t1", { tool: "Read", summary: "a.py" }) },
      { type: "agent.toolCall", call: call("c4", "t1", { tool: "Bash", summary: "" }) });
    const specials = () => model.scene(NOW).trees[0].rows.map((row) => row.command);
    assert.deepEqual(specials(), ["pytest api/tests -q", "npm run lint"]);
    model.handle({ type: "agent.toolCall", call: call("c1", "t1", { tool: "Bash", summary: "pytest api/tests -q", state: "failed", endedAt: NOW }) });
    assert.deepEqual(specials(), ["npm run lint"]);
  });
});

describe("subagents: the kittens", () => {
  test("a started subagent is a kitten on its task's tree", () => {
    const model = fed(snapshot({ tasks: [task("t1", { activity: "working" })] }),
      { type: "subagent.started", subagent: subagent("s1", "t1", { name: "Check links" }) });
    assert.equal(kitten(model, "s1").parent_id, "t1");
    assert.equal(kitten(model, "s1").title, "Check links");
    assert.equal(pose(kitten(model, "s1")), "typing");
  });

  test("a kitten says its latest line until its own calls and notes arrive", () => {
    const model = fed(snapshot({ tasks: [task("t1", { activity: "working" })] }),
      { type: "subagent.started", subagent: subagent("s1", "t1") },
      { type: "subagent.updated", subagent: subagent("s1", "t1", { latest: "Bash npm test" }) });
    assert.deepEqual(kitten(model, "s1").events,
      [{ time: new Date(NOW).toISOString(), tool: "say", detail: "Bash npm test" }]);
    model.handle({ type: "agent.toolCall", call: call("c1", "t1", { subagentId: "s1", tool: "Bash", summary: "npm test" }) });
    assert.deepEqual(kitten(model, "s1").events.map((e) => e.detail), ["npm test"]);
  });

  test("a finished subagent chases yarn for a while, then leaves", () => {
    const model = fed(snapshot({ tasks: [task("t1", { activity: "working" })] }),
      { type: "subagent.started", subagent: subagent("s1", "t1") },
      { type: "subagent.updated", subagent: subagent("s1", "t1", { state: "done", endedAt: NOW }) });
    assert.equal(pose(kitten(model, "s1")), "asleep");   // not working: off the tree, playing
    assert.ok(kitten(model, "s1", NOW + KITTEN_LINGER_MS - 1));
    assert.equal(kitten(model, "s1", NOW + KITTEN_LINGER_MS), undefined);
  });

  test("a waiting task with background subagents still running sips coffee", () => {
    const model = fed(snapshot({ tasks: [task("t1")], subagents: [subagent("s1", "t1"), subagent("s2", "t1")] }));
    assert.equal(pose(cat(model, "t1")), "coffee");
    assert.equal(cat(model, "t1").pending_tasks, 2);
    model.handle({ type: "subagent.updated", subagent: subagent("s1", "t1", { state: "done", endedAt: NOW }) });
    model.handle({ type: "subagent.updated", subagent: subagent("s2", "t1", { state: "failed", endedAt: NOW }) });
    assert.equal(pose(cat(model, "t1")), "asleep");
  });

  test("a waiting task with watchers still running sips coffee too, until they end", () => {
    const model = fed(snapshot({ tasks: [task("t1", { watchers: 2 })] }));
    assert.equal(pose(cat(model, "t1")), "coffee");
    assert.equal(cat(model, "t1").pending_tasks, 2);
    model.handle({ type: "task.updated", task: task("t1", { watchers: 0 }) });
    assert.equal(pose(cat(model, "t1")), "asleep");
  });

  test("kittens and watchers count together; a Glade without the field reads as none", () => {
    const model = fed(snapshot({
      tasks: [task("t1", { watchers: 3 }), task("t2")],
      subagents: [subagent("s1", "t1")],
    }));
    assert.equal(pose(cat(model, "t1")), "coffee");
    assert.equal(cat(model, "t1").pending_tasks, 4);
    assert.equal(pose(cat(model, "t2")), "asleep");
  });
});

describe("questions and permission cards: the raised paw", () => {
  test("a question raises the paw until it's answered or withdrawn", () => {
    const model = fed(snapshot({ tasks: [task("t1", { activity: "working" })] }),
      { type: "question.opened", question: question("t1", "q1") });
    assert.equal(pose(cat(model, "t1")), "paw");
    assert.equal(model.handle({ type: "question.closed", taskId: "t1", questionSetId: "q1", outcome: "answered" }), true);
    assert.equal(pose(cat(model, "t1")), "typing");
    assert.equal(model.handle({ type: "question.closed", taskId: "t1", questionSetId: "q1", outcome: "withdrawn" }), false);
  });

  test("a permission card raises the paw, a subagent's too, until it's answered", () => {
    const model = fed(snapshot({ tasks: [task("t1", { activity: "working" })], subagents: [subagent("s1", "t1")] }),
      { type: "permission.opened", request: permission("t1", "p1", "s1") });
    assert.equal(pose(cat(model, "t1")), "paw");
    model.handle({ type: "permission.closed", taskId: "t1", requestId: "p1", outcome: "denied" });
    assert.equal(pose(cat(model, "t1")), "typing");
  });

  test("the raised paw says what it's asking for: the newest question or card", () => {
    const bubble = (model) => cat(model, "t1").events.at(-1);
    const model = fed(snapshot({ tasks: [task("t1", { activity: "working", waitingOn: "question" })],
      questions: [{ ...question("t1", "q1"), prompts: ["Which limit for /search?", "Burst too?"] }] }));
    assert.deepEqual(bubble(model),
      { time: new Date(NOW).toISOString(), tool: "AskUserQuestion", detail: "Which limit for /search?" });
    model.handle({ type: "permission.opened", request: { ...permission("t1", "p1"), openedAt: NOW + 1 } });
    assert.deepEqual([bubble(model).tool, bubble(model).detail], ["Bash", "rm -rf build"]);
    model.handle({ type: "permission.closed", taskId: "t1", requestId: "p1", outcome: "allowed" });
    assert.equal(bubble(model).tool, "AskUserQuestion");
    model.handle({ type: "question.closed", taskId: "t1", questionSetId: "q1", outcome: "answered" });
    model.handle({ type: "task.updated", task: task("t1", { activity: "working" }) });
    assert.equal(bubble(model), undefined);
  });

  test("the paw stays up for a slow answer", () => {
    const model = fed(snapshot({ tasks: [task("t1", { waitingOn: "question" })] }));
    const later = NOW + 3_600_000;
    assert.equal(pose(cat(model, "t1", later), later / 1000), "paw");
  });
});

describe("idle cats: gone after 15 minutes, back when busy", () => {
  const idleSince = NOW - CAT_IDLE_WINDOW_MS - 1;
  const stale = (id, fields = {}) => task(id, { createdAt: idleSince, updatedAt: idleSince, ...fields });

  test("an idle task leaves once the window passes, asleep until then", () => {
    const model = fed(snapshot({ tasks: [stale("t1"), task("t2", { updatedAt: NOW - CAT_IDLE_WINDOW_MS + 1 })] }));
    assert.deepEqual(cats(model).map((s) => s.id), ["t2"]);
    assert.equal(pose(cat(model, "t2")), "asleep");
  });

  test("a task waiting on your reply or whose turn failed leaves too", () => {
    const model = fed(snapshot({ tasks: [stale("t1", { needsYou: true }), stale("t2", { activity: "error" })] }));
    assert.deepEqual(cats(model), []);
  });

  test("its latest call or note, not just Glade's update, is its last activity", () => {
    const model = fed(snapshot({ tasks: [stale("t1"), stale("t2")] }),
      { type: "agent.toolCall", call: call("c1", "t1", { state: "done", startedAt: NOW - 60_000, endedAt: NOW - 59_000 }) },
      { type: "agent.note", taskId: "t2", subagentId: null, text: "Over to you.", at: NOW - 60_000 });
    assert.deepEqual(cats(model).map((s) => s.id).sort(), ["t1", "t2"]);
    const later = NOW - 60_000 + CAT_IDLE_WINDOW_MS + 1;
    assert.deepEqual(cats(model, later), []);
  });

  test("working, paused, asking a question, waiting on a permission card, or with a watcher out: it stays however long", () => {
    const model = fed(snapshot({
      tasks: [stale("t1", { activity: "working" }), stale("t2", { activity: "paused" }),
        stale("t3", { waitingOn: "question" }), stale("t4"), stale("t5"), stale("t6"),
        stale("t7", { watchers: 1 })],
      questions: [question("t4", "q1")], permissions: [permission("t5", "p1")],
    }));
    const later = NOW + 24 * 3_600_000;
    assert.deepEqual(cats(model, later).map((s) => s.id).sort(),
      ["t1", "t2", "t3", "t4", "t5", "t7"]);
  });

  test("a task with a kitten still out stays; one that's finished keeps it in for the window", () => {
    const model = fed(snapshot({ tasks: [stale("t1"), stale("t2")],
      subagents: [subagent("s1", "t1", { startedAt: idleSince }),
        subagent("s2", "t2", { state: "done", startedAt: idleSince, endedAt: NOW - 60_000 })] }));
    assert.deepEqual(cats(model).map((s) => s.id).sort(), ["t1", "t2"]);
    assert.deepEqual(kittens(model).map((s) => s.id).sort(), ["s1", "s2"]);
    const later = NOW - 60_000 + CAT_IDLE_WINDOW_MS + 1;
    assert.deepEqual(cats(model, later).map((s) => s.id), ["t1"]);
    assert.deepEqual(kittens(model, later).map((s) => [s.id, s.parent_id]), [["s1", "t1"]]);
  });

  test("a cat that left takes its lingering kittens with it: no orphans", () => {
    const model = fed(snapshot({ tasks: [task("t1")],
      subagents: [subagent("s1", "t1", { state: "done", endedAt: NOW })] }));
    const later = NOW + CAT_IDLE_WINDOW_MS + 1;
    assert.equal(cat(model, "t1", later), undefined);
    assert.deepEqual(kittens(model, later), []);
    for (const s of sessionsOf(model, later)) assert.ok(!s.parent_id);
  });

  test("new activity brings it back in", () => {
    const back = (event) => {
      const model = fed(snapshot({ tasks: [stale("t1")] }));
      assert.equal(cat(model, "t1"), undefined);
      model.handle(event);
      return cat(model, "t1");
    };
    assert.equal(pose(back({ type: "agent.toolCall", call: call("c1", "t1") })), "asleep");
    assert.equal(pose(back({ type: "task.updated", task: stale("t1", { activity: "working" }) })), "typing");
    assert.equal(pose(back({ type: "task.updated", task: task("t1") })), "asleep");
    assert.equal(pose(back({ type: "question.opened", question: question("t1", "q1") })), "paw");
    assert.equal(pose(back({ type: "permission.opened", request: permission("t1", "p1") })), "paw");
    assert.ok(back({ type: "subagent.started", subagent: subagent("s1", "t1") }));
  });

  test("the header's count leaves the idle cats out", () => {
    const model = fed(snapshot({ tasks: [stale("t1"), task("t2"), task("t3", { activity: "working" })],
      subagents: [subagent("s1", "t3")] }));
    assert.equal(statusText(model.scene(NOW)), "2 cats · 1 kitten");
    assert.equal(statusText(model.scene(NOW + CAT_IDLE_WINDOW_MS)), "1 cat · 1 kitten");
  });
});

describe("the feed", () => {
  test("hello and event types it doesn't know change nothing", () => {
    const model = fed(snapshot({ tasks: [task("t1")] }));
    assert.equal(model.handle({ type: "hello", app: { name: "Glade", version: "0.11.0" } }), false);
    assert.equal(model.handle({ type: "task.renamed", taskId: "t1" }), false);
    assert.equal(model.handle(null), false);
    assert.deepEqual(cats(model).map((s) => s.id), ["t1"]);
  });

  test("a snapshot followed by updates", () => {
    const model = fed(
      snapshot({ tasks: [task("t1", { activity: "working" }), task("t2")], subagents: [subagent("s1", "t1")] }),
      { type: "task.created", task: task("t3") },
      { type: "task.updated", task: task("t3", { activity: "working", title: "Move uploads to S3" }) },
      { type: "subagent.started", subagent: subagent("s2", "t3") },
      { type: "agent.toolCall", call: call("c1", "t3", { subagentId: "s2", tool: "Bash", summary: "aws s3 sync" }) },
      { type: "question.opened", question: question("t2", "q1") },
      { type: "task.updated", task: task("t1", { state: "done" }) },
    );
    assert.deepEqual(cats(model).map((s) => s.id).sort(), ["t2", "t3"]);
    assert.deepEqual(kittens(model).map((s) => s.id), ["s2"]);
    assert.equal(pose(cat(model, "t2")), "paw");
    assert.equal(cat(model, "t3").title, "acme-api · Move uploads to S3");
    assert.equal(statusText(model.scene(NOW)), "2 cats · 1 kitten");
  });

  test("a fresh snapshot after ready replaces the state, keeping survivors' bubbles but nothing running", () => {
    const model = fed(
      snapshot({ tasks: [task("t1", { activity: "working" }), task("t2")] }),
      { type: "agent.toolCall", call: call("c1", "t1", { tool: "Bash", summary: "make" }) },
      { type: "agent.note", taskId: "t2", subagentId: null, text: "Done for now.", at: NOW },
      { type: "question.opened", question: question("t2", "q1") },
    );
    model.handle({ type: "hello", app: { name: "Glade", version: "0.11.0" } });
    model.handle(snapshot({ tasks: [task("t1", { activity: "working" }), task("t4")] }));
    assert.deepEqual(cats(model).map((s) => s.id).sort(), ["t1", "t4"]);
    assert.deepEqual(cat(model, "t1").events.map((e) => e.detail), ["make"]);
    assert.equal(cat(model, "t1").awaiting, "model");
    assert.deepEqual(model.scene(NOW).trees[0].rows, []);
    // t2 is gone, and so is its question: back again, it has neither
    model.handle({ type: "task.created", task: task("t2") });
    assert.deepEqual(cat(model, "t2").events, []);
    assert.equal(pose(cat(model, "t2")), "asleep");
  });

  test("stress: many tasks, subagents coming and going, tasks done and deleted mid-turn", () => {
    let seed = 7;
    const random = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const model = fed(snapshot());
    const live = new Map();       // task id → Set of running subagent ids
    let nextId = 0;
    for (let step = 0; step < 3000; step++) {
      const ids = [...live.keys()];
      const pick = ids[random(Math.max(1, ids.length))];
      const roll = random(10);
      if (roll < 3 || !pick) {
        const id = `t${nextId++}`;
        live.set(id, new Set());
        model.handle({ type: "task.created", task: task(id, { activity: "working" }) });
      } else if (roll < 5) {
        const id = `s${nextId++}`;
        live.get(pick).add(id);
        model.handle({ type: "subagent.started", subagent: subagent(id, pick) });
        model.handle({ type: "agent.toolCall", call: call(`c${nextId++}`, pick, { subagentId: id }) });
      } else if (roll < 7 && live.get(pick).size) {
        const id = [...live.get(pick)][0];
        live.get(pick).delete(id);
        model.handle({ type: "subagent.updated", subagent: subagent(id, pick, { state: "done", endedAt: NOW - KITTEN_LINGER_MS }) });
      } else if (roll === 7) {
        model.handle({ type: "agent.toolCall", call: call(`c${nextId++}`, pick, { tool: "Bash", summary: "make" }) });
      } else if (roll === 8) {
        live.delete(pick);
        model.handle({ type: "task.updated", task: task(pick, { state: "done" }) });
      } else {
        live.delete(pick);
        model.handle({ type: "task.deleted", taskId: pick });
        model.handle({ type: "agent.toolCall", call: call(`c${nextId++}`, pick) });
      }
      if (step % 250 === 0 || step === 2999) {
        const data = model.scene(NOW);
        const running = [...live.values()].reduce((sum, set) => sum + set.size, 0);
        assert.deepEqual(data.sessions.filter((s) => !s.parent_id).map((s) => s.id).sort(), [...live.keys()].sort());
        assert.equal(data.sessions.filter((s) => s.parent_id).length, running);
        for (const s of data.sessions.filter((s) => s.parent_id)) assert.ok(live.get(s.parent_id).has(s.id));
        assert.equal(statusText(data),
          `${live.size} cat${live.size === 1 ? "" : "s"}` +
          (running ? ` · ${running} kitten${running === 1 ? "" : "s"}` : ""));
      }
    }
    assert.ok(nextId > 1000);
  });
});

describe("statusText", () => {
  const data = (catCount, kittenCount) => ({ sessions: [
    ...Array.from({ length: catCount }, (_, i) => ({ id: `t${i}`, parent_id: "" })),
    ...Array.from({ length: kittenCount }, (_, i) => ({ id: `s${i}`, parent_id: "t0" })),
  ] });
  test("counts cats, and kittens when there are any", () => {
    assert.equal(statusText(data(0, 0)), "0 cats");
    assert.equal(statusText(data(1, 0)), "1 cat");
    assert.equal(statusText(data(1, 1)), "1 cat · 1 kitten");
    assert.equal(statusText(data(5, 4)), "5 cats · 4 kittens");
  });
  test("fits Glade's 40-character header", () => {
    assert.ok(statusText(data(9999, 9999)).length <= 40);
  });
});

// ------------------------------------------------------------------ bridge
function fakeWindow() {
  const posted = [];
  const listeners = [];
  return {
    posted,
    glade: { post: (message) => posted.push(message) },
    addEventListener: (type, listener) => { if (type === "message") listeners.push(listener); },
    send: (event, envelope = {}) =>
      listeners.forEach((listener) => listener({ data: { source: "glade", apiVersion: 1, seq: 1, event, ...envelope } })),
  };
}

describe("a cat's name", () => {
  test("is its workspace, then its task", () => {
    const model = fed(snapshot({ tasks: [task("t1", { workspaceName: "penny", title: "Land the eval ports" }),
      task("t2", { workspaceName: "glade", title: "" })] }));
    assert.equal(cat(model, "t1").title, "penny · Land the eval ports");
    assert.equal(cat(model, "t2").title, "glade · New task");
  });

  test("is just the task when Glade gives no workspace name", () => {
    const model = fed(snapshot({ tasks: [task("t1", { workspaceName: "", title: "Fix flaky login" })] }));
    assert.equal(cat(model, "t1").title, "Fix flaky login");
  });

  test("follows a renamed workspace", () => {
    const model = fed(snapshot({ tasks: [task("t1", { title: "Fix flaky login" })] }),
      { type: "task.updated", task: task("t1", { workspaceName: "acme-web", title: "Fix flaky login" }) });
    assert.equal(cat(model, "t1").title, "acme-web · Fix flaky login");
  });
});

describe("the art style setting", () => {
  test("a Glade without plugin settings sends none, and the scene keeps its default", () => {
    assert.equal("style" in fed(snapshot({ tasks: [task("t1")] })).scene(NOW), false);
  });

  test("the snapshot's style setting is handed to the scene", () => {
    const model = fed(snapshot({ tasks: [task("t1")], settings: { style: "16bit" } }));
    assert.equal(model.scene(NOW).style, "16bit");
  });

  test("changing it in Settings re-renders with the new style", () => {
    const model = fed(snapshot({ settings: { style: "8bit" } }));
    assert.equal(model.handle({ type: "settings.changed", settings: { style: "32bit" } }), true);
    assert.equal(model.scene(NOW).style, "32bit");
    // the same value again changes nothing
    assert.equal(model.handle({ type: "settings.changed", settings: { style: "32bit" } }), false);
  });

  test("a fresh snapshot without the setting forgets it", () => {
    const model = fed(snapshot({ settings: { style: "16bit" } }), snapshot());
    assert.equal("style" in model.scene(NOW), false);
  });
});

describe("connect", () => {
  test("posts ready, then renders and posts the count once the snapshot is in", () => {
    const win = fakeWindow();
    const scenes = [];
    connect(win, (data) => scenes.push(data), () => NOW);
    assert.deepEqual(win.posted, [{ type: "ready" }]);
    win.send({ type: "hello", app: { name: "Glade", version: "0.11.0" } });
    win.send({ type: "task.created", task: task("t0") });   // before any snapshot: not live yet
    assert.equal(scenes.length, 0);
    win.send(snapshot({ tasks: [task("t1"), task("t2")], subagents: [subagent("s1", "t1")] }));
    assert.equal(scenes.length, 1);
    assert.deepEqual(win.posted.at(-1), { type: "status", text: "2 cats · 1 kitten" });
    win.send({ type: "task.created", task: task("t3") });
    assert.equal(scenes.length, 2);
    assert.deepEqual(win.posted.at(-1), { type: "status", text: "3 cats · 1 kitten" });
  });

  test("ignores what isn't Glade's, or another API version", () => {
    const win = fakeWindow();
    const scenes = [];
    connect(win, (data) => scenes.push(data), () => NOW);
    win.send(snapshot({ tasks: [task("t1")] }), { source: "elsewhere" });
    win.send(snapshot({ tasks: [task("t1")] }), { apiVersion: 2 });
    win.send(null);
    assert.equal(scenes.length, 0);
    assert.deepEqual(win.posted, [{ type: "ready" }]);
  });

  test("posts the status only when it changes, and ticks on as time passes", () => {
    const win = fakeWindow();
    const scenes = [];
    let now = NOW;
    const link = connect(win, (data) => scenes.push(data), () => now);
    link.tick();
    assert.equal(scenes.length, 0);
    assert.equal(link.isLive(), false);
    win.send(snapshot({ tasks: [task("t1", { activity: "working" })] }));
    win.send({ type: "subagent.started", subagent: subagent("s1", "t1") });
    win.send({ type: "subagent.updated", subagent: subagent("s1", "t1", { state: "done", endedAt: NOW }) });
    win.send({ type: "agent.note", taskId: "t1", subagentId: null, text: "Next.", at: NOW });
    assert.deepEqual(win.posted.filter((m) => m.type === "status").map((m) => m.text), ["1 cat", "1 cat · 1 kitten"]);
    now = NOW + KITTEN_LINGER_MS;
    link.tick();
    assert.equal(scenes.at(-1).generated_at, now / 1000);
    assert.deepEqual(win.posted.at(-1), { type: "status", text: "1 cat" });
    assert.equal(link.isLive(), true);
  });

  test("an idle cat leaves on a tick, with no event, and comes back on the next one", () => {
    const win = fakeWindow();
    const scenes = [];
    let now = NOW;
    const link = connect(win, (data) => scenes.push(data), () => now);
    win.send(snapshot({ tasks: [task("t1"), task("t2", { activity: "working" })] }));
    assert.deepEqual(win.posted.at(-1), { type: "status", text: "2 cats" });
    now = NOW - 60_000 + CAT_IDLE_WINDOW_MS + 1;
    link.tick();
    assert.deepEqual(scenes.at(-1).sessions.map((s) => s.id), ["t2"]);
    assert.deepEqual(win.posted.at(-1), { type: "status", text: "1 cat" });
    win.send({ type: "agent.note", taskId: "t1", subagentId: null, text: "Back.", at: now });
    assert.deepEqual(win.posted.at(-1), { type: "status", text: "2 cats" });
  });

  test("each machine reading re-renders the room, without posting the status again", () => {
    const win = fakeWindow();
    const scenes = [];
    connect(win, (data) => scenes.push(data), () => NOW);
    win.send(snapshot({ tasks: [task("t1")], machine: [] }));
    const statuses = win.posted.filter((m) => m.type === "status").length;
    win.send({ type: "machine.reading", reading: reading(NOW) });
    win.send({ type: "machine.reading", reading: reading(NOW + 2_000, { total: 9.5 }) });
    assert.equal(scenes.length, 3);
    assert.equal(scenes.at(-1).history.at(-1).total, 9.5);
    assert.equal(scenes.at(-1).cpu_count, 10);
    assert.equal(win.posted.filter((m) => m.type === "status").length, statuses);
  });

  test("an event that changes nothing doesn't re-render", () => {
    const win = fakeWindow();
    const scenes = [];
    connect(win, (data) => scenes.push(data), () => NOW);
    win.send(snapshot());
    win.send({ type: "agent.toolCall", call: call("c1", "unknown") });
    assert.equal(scenes.length, 1);
  });

  test("opening a cat's task asks Glade for it, and a kitten's for its subagent too", () => {
    const win = fakeWindow();
    const link = connect(win, () => {}, () => NOW);
    win.send(snapshot({ tasks: [task("t1")], subagents: [subagent("s1", "t1")] }));
    link.open("t1");
    link.open("t1", "s1");
    assert.deepEqual(win.posted.filter((message) => message.type === "openTask"), [
      { type: "openTask", taskId: "t1", subagentId: null },
      { type: "openTask", taskId: "t1", subagentId: "s1" },
    ]);
  });

  test("outside Glade, with no bridge, there's nothing to connect to", () => {
    assert.equal(connect({ addEventListener() {} }, () => {}), null);
  });
});

// ------------------------------------------------------------------ build
describe("the plugin build", () => {
  test("its manifest passes Glade's rules", () => {
    const { id, name, version, entry, icon, capabilities } = manifest();
    assert.deepEqual(capabilities, ["machine"]);
    // the art style is a select setting (glade#435), one option per style in web/art/
    const { settings } = manifest();
    assert.equal(settings.length, 2);
    const [style, theme] = settings;
    // and the theme: the everyday cafe, by date (the default), or one of the theme files
    assert.deepEqual([theme.key, theme.type, theme.default], ["theme", "select", "seasonal"]);
    assert.deepEqual(theme.options.map((option) => option.value), ["default", "seasonal", ...themes()]);
    assert.deepEqual([style.key, style.type, style.default], ["style", "select", "8bit"]);
    assert.deepEqual(style.options.map((option) => option.value), styles());
    assert.ok(style.options.some((option) => option.value === "8bit" && option.label === "8-bit"));
    assert.ok(style.options.every((option) => existsSync(new URL(`../web/art/${option.value}.js`, import.meta.url))));
    assert.equal(id, "nekomata");
    assert.match(id, /^[a-z0-9][a-z0-9-]{0,63}$/);
    assert.ok(name.length > 0 && name.length <= 40);
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.equal(entry, "index.html");
    assert.equal(icon, "icon.svg");
  });

  test("its page is one self-contained file, with the adapter and the art ahead of the scene", () => {
    const html = page();
    assert.ok(!html.includes("/*__STYLES__*/") && !html.includes("/*__APP__*/"));
    assert.ok(html.indexOf("NekomataGlade = api") < html.indexOf("const gladeFeed"));
    // and the art styles ahead of the scene that draws with them
    assert.ok(html.indexOf("NekomataArt[art.id] = art") < html.indexOf("let ART = "));
    assert.doesNotMatch(html, /<link\b|<script[^>]+src=|<img\b|url\(/i);
    assert.doesNotMatch(html, /https?:\/\//);
  });

  test("writes the folder Glade loads", () => {
    const out = join(mkdtempSync(join(tmpdir(), "nekomata-")), "nekomata");
    try {
      build(out);
      assert.deepEqual(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")), manifest());
      assert.equal(readFileSync(join(out, "index.html"), "utf8"), page());
      assert.ok(existsSync(join(out, "icon.svg")));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
