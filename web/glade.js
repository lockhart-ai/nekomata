"use strict";
// Nekomata inside Glade. Glade (github.com/lockhart-ai/glade) runs this page as a
// sandboxed plugin and feeds it task and agent events (its docs/plugin-api.md,
// version 1) instead of the /data snapshots fleet_dashboard.py serves. This
// adapter keeps a model of those events and turns it into the same scene data
// app.js's apply() takes: a task is a cat, a subagent is a kitten, a question or
// permission card raises the cat's paw, tool calls and notes are the speech
// bubbles, and a task that's done or deleted leaves (the adoption man carries it
// out), as does one left idle a while, until it's busy again.
//
// The room's CPU, GPU and Docker readings come from Glade's `machine`
// capability, which the manifest asks for and you turn on in Glade's Settings ›
// Plugins: then the snapshot carries the latest readings and a
// `machine.reading` follows every ~2 s, and they fill the same cpu_count, gpu,
// docker and history fields fleet_dashboard.py serves. With it off (or an older
// Glade), there are none, and the room stays quiet: a cool window, an empty
// pastry case and an idle espresso machine.
//
// The Glade build (`./build.sh glade`) inlines this file ahead of app.js; the
// browser page and the VS Code extension don't include it. Tests: test/glade.test.js.
(function (root) {
  const API_VERSION = 1;

  // What a session keeps for its speech bubble and hover card: its latest few.
  const MAX_EVENTS_PER_SESSION = 20;
  // A finished subagent stays on the floor chasing yarn this long, as a kitten
  // does between turns in the terminal build, then leaves.
  const KITTEN_LINGER_MS = 5 * 60 * 1000;
  // A cat with nothing going on leaves after this long, as in the terminal
  // build (fleet_dashboard.py's SESSION_ACTIVE_WINDOW_SECONDS).
  const CAT_IDLE_WINDOW_MS = 15 * 60 * 1000;
  // Glade's own name for a task the agent hasn't named yet.
  const UNTITLED_TASK = "New task";

  // A cat's name: its workspace, then its task's title (Glade's own name for an untitled one).
  function catName(task) {
    const title = task.title || UNTITLED_TASK;
    return task.workspaceName ? `${task.workspaceName} · ${title}` : title;
  }
  // An age app.js's sessionStatus reads as awake but not typing (45s–5m): the
  // cat sits up for a raised paw or a coffee break, without the typing bob.
  const AWAKE_SECONDS = 60;
  // A modified_at so old the cat is asleep: a task waiting on you with nothing
  // left running.
  const ASLEEP = 0;
  // The machine readings kept for the scene's history, as Glade's snapshot
  // keeps them: about two minutes.
  const MAX_MACHINE_HISTORY = 60;

  // ------------------------------------------------------------ the machine
  // A container's memory in bytes as `docker stats` words it ("420MiB"), for
  // the docker list fleet_dashboard.py serves.
  function formatBytes(bytes) {
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let value = Number(bytes) || 0;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    const shown = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${shown}${units[unit]}`;
  }

  // Whether a value looks like one of Glade's machine readings: enough of it
  // for the scene, so a malformed one is dropped rather than drawn.
  function isReading(reading) {
    return !!reading && typeof reading === "object" && Number.isFinite(reading.t) &&
      Number.isFinite(reading.total) && Number.isFinite(reading.cpuCount);
  }

  // The machine's readings, as the scene's cpu_count, gpu, docker and history.
  function createMachine() {
    let readings = [];   // oldest first; empty when the capability is off

    function reset(list) {
      readings = (Array.isArray(list) ? list : []).filter(isReading).slice(-MAX_MACHINE_HISTORY);
    }

    function add(reading) {
      if (!isReading(reading)) return false;
      readings.push(reading);
      if (readings.length > MAX_MACHINE_HISTORY) readings.splice(0, readings.length - MAX_MACHINE_HISTORY);
      return true;
    }

    function fields() {
      const latest = readings[readings.length - 1];
      if (!latest) return {cpu_count: 0, gpu: null, docker: [], history: []};
      return {
        cpu_count: latest.cpuCount,
        gpu: typeof latest.gpu === "number" ? latest.gpu : null,
        docker: (Array.isArray(latest.containers) ? latest.containers : []).map((container) => ({
          name: String(container.name), status: "", cpu: Number(container.cpu) || 0,
          memory: formatBytes(container.memory),
        })),
        // fleet_dashboard.py's history entries, with its times in seconds
        history: readings.map((reading) => ({
          t: reading.t / 1000, claude: Number(reading.claude) || 0,
          docker: Number(reading.docker) || 0, total: reading.total,
        })),
      };
    }

    return {reset, add, fields};
  }

  // ---------------------------------------------------------------- the model
  function createModel() {
    const tasks = new Map();          // task id → PluginTask (active ones only)
    const subagents = new Map();      // subagent id → PluginSubagent
    const activity = new Map();       // session id (task or subagent) → [entry]
    const questions = new Map();      // question set id → PluginQuestion
    const permissions = new Map();    // permission request id → PluginPermissionRequest
    const machine = createMachine();  // the `machine` capability's readings
    let style = null;                 // the plugin's "style" setting, once Glade sends one
    let theme = null;                 // and its "theme" setting

    // The art style from a `settings` object (glade#435): the snapshot carries
    // every declared setting, and `settings.changed` follows when you change one.
    // A Glade without plugin settings sends none, and the scene keeps its default.
    function readSettings(settings) {
      const pick = (key) => settings && typeof settings[key] === "string" ? settings[key] : null;
      const [wantedStyle, wantedTheme] = [pick("style"), pick("theme")];
      if (wantedStyle === style && wantedTheme === theme) return false;
      [style, theme] = [wantedStyle, wantedTheme];
      return true;
    }

    function forgetTask(taskId) {
      tasks.delete(taskId);
      for (const [id, subagent] of subagents)
        if (subagent.taskId === taskId) subagents.delete(id);
      for (const [id, entries] of activity)
        if (entries.length && entries[0].taskId === taskId) activity.delete(id);
      for (const [id, open] of questions) if (open.taskId === taskId) questions.delete(id);
      for (const [id, open] of permissions) if (open.taskId === taskId) permissions.delete(id);
    }

    function putTask(task) {
      if (task.state === "active") tasks.set(task.id, task);
      else forgetTask(task.id);   // done: carried out, with its kittens
    }

    function record(sessionId, entry) {
      let entries = activity.get(sessionId);
      if (!entries) { entries = []; activity.set(sessionId, entries); }
      const index = entry.callId ? entries.findIndex((e) => e.callId === entry.callId) : -1;
      if (index >= 0) entries[index] = entry;   // a call's end replaces its start
      else entries.push(entry);
      if (entries.length > MAX_EVENTS_PER_SESSION) entries.splice(0, entries.length - MAX_EVENTS_PER_SESSION);
    }

    function handle(event) {
      if (!event || typeof event !== "object") return false;
      switch (event.type) {
        case "hello":
          return false;   // the snapshot that follows replaces everything
        case "snapshot": {
          const kept = new Set();
          tasks.clear(); subagents.clear(); questions.clear(); permissions.clear();
          for (const task of event.tasks || []) if (task.state === "active") { tasks.set(task.id, task); kept.add(task.id); }
          for (const subagent of event.subagents || [])
            if (tasks.has(subagent.taskId)) { subagents.set(subagent.id, subagent); kept.add(subagent.id); }
          for (const question of event.questions || [])
            if (tasks.has(question.taskId)) questions.set(question.questionSetId, question);
          for (const request of event.permissions || [])
            if (tasks.has(request.taskId)) permissions.set(request.requestId, request);
          // Keep the bubbles of whoever is still here, but not what they were
          // running: a call's end may have been missed, which is why we're here.
          for (const [id, entries] of activity) {
            if (!kept.has(id)) activity.delete(id);
            else for (const entry of entries) entry.running = false;
          }
          // The latest machine readings, with the capability on; none without.
          machine.reset(event.machine);
          readSettings(event.settings);
          return true;
        }
        case "settings.changed":
          return readSettings(event.settings);
        case "machine.reading":
          return machine.add(event.reading);
        case "task.created":
        case "task.updated":
          // A done task isn't in the snapshot, so one reopened arrives as an
          // update for a task we don't know: it's simply new.
          putTask(event.task);
          return true;
        case "task.deleted":
          forgetTask(event.taskId);
          return true;
        case "agent.toolCall": {
          const call = event.call;
          if (!tasks.has(call.taskId)) return false;   // its task is gone
          record(call.subagentId || call.taskId, {
            taskId: call.taskId, callId: call.id, at: call.startedAt,
            tool: call.tool, detail: call.summary, running: call.state === "running",
          });
          return true;
        }
        case "agent.note":
          if (!tasks.has(event.taskId)) return false;
          record(event.subagentId || event.taskId, {
            taskId: event.taskId, callId: null, at: event.at,
            tool: "say", detail: event.text, running: false,
          });
          return true;
        case "subagent.started":
        case "subagent.updated":
          if (!tasks.has(event.subagent.taskId)) return false;
          subagents.set(event.subagent.id, event.subagent);
          return true;
        case "question.opened":
          if (!tasks.has(event.question.taskId)) return false;
          questions.set(event.question.questionSetId, event.question);
          return true;
        case "question.closed":
          return questions.delete(event.questionSetId);
        case "permission.opened":
          if (!tasks.has(event.request.taskId)) return false;
          permissions.set(event.request.requestId, event.request);
          return true;
        case "permission.closed":
          return permissions.delete(event.requestId);
        default:
          return false;   // a newer Glade's event: ignored, as the API asks
      }
    }

    function eventsOf(sessionId) {
      return (activity.get(sessionId) || []).map((entry) => ({
        time: new Date(entry.at).toISOString(), tool: entry.tool, detail: entry.detail,
      }));
    }

    function runningCall(sessionId) {
      const entries = activity.get(sessionId) || [];
      return entries.some((entry) => entry.running);
    }

    function lastActivitySeconds(sessionId, fallback) {
      const entries = activity.get(sessionId) || [];
      return entries.length ? Math.max(...entries.map((entry) => entry.at)) / 1000 : fallback;
    }

    // The newest open question or permission card of a task, as a bubble:
    // the question's first prompt, or the call waiting on your OK.
    function openAsk(taskId) {
      let newest = null;
      for (const question of questions.values())
        if (question.taskId === taskId && (!newest || question.openedAt >= newest.at))
          newest = {at: question.openedAt, tool: "AskUserQuestion", detail: question.prompts[0] || ""};
      for (const request of permissions.values())
        if (request.taskId === taskId && (!newest || request.openedAt >= newest.at))
          newest = {at: request.openedAt, tool: request.tool, detail: request.summary};
      return newest;
    }

    function catSession(task, runningKittens, nowMs) {
      const nowSeconds = nowMs / 1000;
      const now = new Date(nowMs).toISOString();
      const events = eventsOf(task.id);
      // Before its first call or note (just after a snapshot), a cat says its
      // task's status line.
      if (!events.length && task.status) events.push({time: now, tool: "say", detail: task.status});
      const session = {
        id: task.id, parent_id: "", project: task.workspaceName,
        // every workspace's tasks share the cafe, so a cat's name says whose it is
        title: catName(task), branch: "", events,
        awaiting: "user", pending_tasks: 0, modified_at: ASLEEP, is_self: false,
      };
      const ask = openAsk(task.id);
      if (task.waitingOn || ask) {
        // a question or a permission card: sitting up, paw raised, saying
        // what it's asking for as long as it's open
        session.awaiting = "question";
        session.modified_at = nowSeconds - AWAKE_SECONDS;
        if (ask) events.push({time: now, tool: ask.tool, detail: ask.detail});
      } else if (task.activity === "working") {
        // typing; a call that's been running a while turns into a coffee break
        const calling = runningCall(task.id);
        session.awaiting = calling ? "tool" : "model";
        session.modified_at = lastActivitySeconds(task.id, nowSeconds);
      } else if (task.activity === "paused") {
        // a usage limit or offline: it resumes on its own, so coffee
        session.awaiting = "tool";
        session.modified_at = nowSeconds - AWAKE_SECONDS;
      } else if (runningKittens > 0) {
        // its turn is over but background subagents still run: coffee, with
        // a dot per kitten still out
        session.pending_tasks = runningKittens;
        session.modified_at = nowSeconds - AWAKE_SECONDS;
      }
      // otherwise waiting on you, or its turn failed: asleep
      return session;
    }

    function kittenSession(subagent, nowMs) {
      const nowSeconds = nowMs / 1000;
      const running = subagent.state === "running";
      let events = eventsOf(subagent.id);
      // Before its own calls and notes arrive, it says its latest line.
      if (!events.length && subagent.latest)
        events = [{time: new Date(nowMs).toISOString(), tool: "say", detail: subagent.latest}];
      return {
        id: subagent.id, parent_id: subagent.taskId, project: "", title: subagent.name,
        branch: "", events, pending_tasks: 0, is_self: false,
        awaiting: !running ? "user" : runningCall(subagent.id) ? "tool" : "model",
        modified_at: running ? nowSeconds : ASLEEP,
      };
    }

    function kittensShown(nowMs) {
      return [...subagents.values()]
        .filter((subagent) => subagent.state === "running" ||
          nowMs - (subagent.endedAt || 0) < KITTEN_LINGER_MS)
        .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    }

    // When a task last did anything: its own calls and notes, its subagents
    // starting and ending, or Glade updating it.
    function lastActivityMs(task) {
      let latest = task.updatedAt || 0;
      for (const entry of activity.get(task.id) || []) latest = Math.max(latest, entry.at);
      for (const subagent of subagents.values())
        if (subagent.taskId === task.id)
          latest = Math.max(latest, subagent.startedAt || 0, subagent.endedAt || 0);
      return latest;
    }

    // Idle: not working, not paused, not asking you anything and no kitten
    // still out. A task waiting on your reply counts too. It stays in the
    // model, so its next event brings the cat back in.
    function goneIdle(task, runningKittens, nowMs) {
      if (task.activity === "working" || task.activity === "paused") return false;
      if (task.waitingOn || openAsk(task.id) || runningKittens > 0) return false;
      return nowMs - lastActivityMs(task) > CAT_IDLE_WINDOW_MS;
    }

    // The data app.js's apply() takes, as of `nowMs`.
    function scene(nowMs) {
      const nowSeconds = nowMs / 1000;
      const sessions = [];
      const here = new Set();
      const kittens = kittensShown(nowMs);
      for (const task of tasks.values()) {
        const running = kittens.filter((k) => k.taskId === task.id && k.state === "running").length;
        if (goneIdle(task, running, nowMs)) continue;
        here.add(task.id);
        sessions.push(catSession(task, running, nowMs));
      }
      // a cat that left takes its lingering kittens with it
      for (const kitten of kittens)
        if (here.has(kitten.taskId)) sessions.push(kittenSession(kitten, nowMs));
      // the chalkboard's "specials": the commands running right now
      const commands = [];
      for (const entries of activity.values())
        for (const entry of entries)
          if (entry.running && entry.tool === "Bash" && entry.detail)
            commands.push({is_wrapper: true, command: entry.detail});
      return {
        generated_at: nowSeconds, server_started: "glade",
        // the machine's readings with the capability on; without, a cool
        // window, an empty pastry case and a quiet espresso machine
        ...machine.fields(),
        trees: [{rows: commands}], sessions,
        // the art style picked in Glade's Settings › Plugins, if it has sent one
        ...(style ? {style} : {}),
        ...(theme ? {theme} : {}),
      };
    }

    return {handle, scene};
  }

  // ------------------------------------------------------------- the header
  // The count Glade shows at the right of the panel header, as the corner
  // reads in the terminal build: "5 cats · 4 kittens".
  function statusText(data) {
    const cats = data.sessions.filter((s) => !s.parent_id).length;
    const kittens = data.sessions.length - cats;
    const kittenPart = kittens ? ` · ${kittens} kitten${kittens === 1 ? "" : "s"}` : "";
    return `${cats} cat${cats === 1 ? "" : "s"}${kittenPart}`;
  }

  function isGladeMessage(message) {
    return !!message && message.source === "glade" && message.apiVersion === API_VERSION &&
      !!message.event && typeof message.event === "object";
  }

  // ------------------------------------------------------------ the bridge
  // Listens for Glade's messages on `win`, posts `ready`, and calls onScene
  // with fresh scene data once the snapshot is in and after every change;
  // tick() refreshes it as time passes. Null when `win` isn't a Glade plugin
  // page (no window.glade bridge).
  function connect(win, onScene, clock) {
    const bridge = win.glade;
    if (!bridge || typeof bridge.post !== "function") return null;
    const now = clock || (() => Date.now());
    const model = createModel();
    let live = false;
    let lastStatus = null;

    function publish() {
      const data = model.scene(now());
      onScene(data);
      const text = statusText(data);
      if (text !== lastStatus) {
        lastStatus = text;
        bridge.post({type: "status", text});
      }
    }

    win.addEventListener("message", (event) => {
      const message = event.data;
      if (!isGladeMessage(message)) return;
      const changed = model.handle(message.event);
      if (message.event.type === "snapshot") live = true;
      if (live && changed) publish();
    });
    bridge.post({type: "ready"});

    return {
      tick() { if (live) publish(); },
      isLive() { return live; },
      // Asks Glade to show a task (and one of its subagents, for a kitten). Glade only
      // does it right after a real click in the plugin's view, once per click, and an
      // older Glade drops the message; either way there's nothing to do here if it won't.
      open(taskId, subagentId) {
        bridge.post({type: "openTask", taskId, subagentId: subagentId || null});
      },
    };
  }

  const api = {
    API_VERSION, KITTEN_LINGER_MS, CAT_IDLE_WINDOW_MS, MAX_MACHINE_HISTORY,
    createModel, statusText, connect, formatBytes,
  };
  root.NekomataGlade = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
