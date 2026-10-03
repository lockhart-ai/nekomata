"use strict";
// ------------------------------------------------------------ constants
const PALETTE = ["#3987e5", "#199e70", "#c98500", "#008300",
                 "#9085e9", "#e66767", "#d55181", "#d95926"];
// What the scene looks like is a style's business (web/art/): it draws the room, the cats
// and everything else, and says where things sit. This file decides what happens. Scene
// coordinates are the style's art pixels: ART.px scene pixels each on the 720x360 scene.
// The style is picked by the page's ?style= (the VS Code setting, or typed by hand) or, in
// Glade, by the plugin's setting; useStyle() below swaps it while the scene runs.
const DEFAULT_STYLE = "8bit";
let ART = NekomataArt[DEFAULT_STYLE];
let UNIT = ART.px;
let SCENE_W = ART.width;
// The scene is never narrower than SCENE_W, but it widens to match the
// viewport's aspect ratio so the cafe fills its box instead of letterboxing.
let SCENE_W_MAX = Math.round(2400 / UNIT);
let sceneW = SCENE_W;
let sceneH = ART.height;
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

// ------------------------------------------------------------ scene state
const canvas = document.getElementById("scene");
const context = canvas.getContext("2d");
// what a style draws onto
const pen = {
  rect(x, y, w, h, color) { context.fillStyle = color; context.fillRect(x, y, w, h); },
};

function fitSceneToViewport() {
  // Widen the scene to the viewport's aspect ratio; the style lays its room
  // out for whatever width it's given.
  const box = canvas.getBoundingClientRect();
  if (!box.width || !box.height) return false;
  const wanted = Math.min(SCENE_W_MAX,
    Math.max(SCENE_W, Math.round(sceneH * box.width / box.height)));
  if (wanted === sceneW) return false;
  sceneW = wanted;
  canvas.width = sceneW;
  return true;
}
const overlay = document.getElementById("overlay");
// Inside Glade, web/glade.js is inlined ahead of this script and the scene is
// fed by Glade's plugin events instead of the server: no /data, no client log.
const gladeFeed = typeof NekomataGlade === "object" ? NekomataGlade : null;
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

function useStyle(id) {
  // An id this build doesn't have (a newer setting, a typo) keeps the style in use.
  const art = NekomataArt[id];
  if (!art || art === ART) return false;
  ART = art;
  UNIT = ART.px;
  SCENE_W = ART.width;
  SCENE_W_MAX = Math.round(2400 / UNIT);
  sceneW = SCENE_W;
  sceneH = ART.height;
  canvas.width = sceneW;
  canvas.height = sceneH;
  document.documentElement.dataset.style = ART.id;
  // Positions are in the old style's pixels: start the floor over, with no
  // ceremonies for cats that were already here.
  spots = [];
  spotBySession.clear();
  kittenPlay.clear();
  adoptionRuns = [];
  hiddenCatIds.clear();
  knownCatInfo = null;
  return true;
}

function requestedStyle() {
  try { return new URLSearchParams(location.search).get("style"); } catch (error) { return null; }
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

// ------------------------------------------------------------ kittens at play
const KITTEN_YARN_COLORS = ["#e05a6a", "#9085e9", "#f7d64a", "#6db5e8"];

// Now and then a playing kitten leaves its yarn on an errand: a drink or a nibble at the
// bowls when it's over on the right of the cafe, a swat at a plant it has wandered near,
// and, while the CPU runs hot, a nap in the sunbeam. The style says where those are
// (ART.attractions); an errand is walking there, then doing it for a while.
const ERRAND_FRAMES = {water: [9, 15], food: [9, 15], plant: [8, 13], sun: [30, 55]};
const HOT_CPU = 70;   // the window's "hot" sun

function between([low, high]) { return low + Math.floor(Math.random() * (high - low + 1)); }

function chooseErrand(play, readings) {
  if (!ART.attractions) return null;
  const busy = new Set([...kittenPlay.values()]
    .filter((other) => other !== play && other.errand && other.errand.kind !== "sun")
    .map((other) => other.errand.key));
  const options = ART.attractions(sceneW, readings).filter((spot) => {
    if (spot.kind === "sun") return readings.cpuLoad >= HOT_CPU;
    if (busy.has(spot.kind + spot.x)) return false;            // one kitten at a bowl or plant
    if (spot.kind === "plant") return Math.hypot(spot.x - play.x, spot.y - play.y) < 110 / UNIT;
    return play.x > sceneW * 0.55;                               // the bowls, on the right
  });
  if (!options.length) return null;
  // a warm kitten heads for the sun more often than not
  const sun = options.find((spot) => spot.kind === "sun");
  const spot = sun && Math.random() < 0.7 ? sun
    : options[Math.floor(Math.random() * options.length)];
  const at = spot.area
    ? {x: spot.area.x0 + Math.random() * (spot.area.x1 - spot.area.x0),
       y: spot.area.y0 + Math.random() * (spot.area.y1 - spot.area.y0)}
    : {x: spot.x, y: spot.y};
  return {kind: spot.kind, key: spot.kind + spot.x, x: at.x, y: at.y,
          facing: spot.facing || 1, phase: "go", until: 0};
}

function runErrand(play, readings) {
  const errand = play.errand;
  if (errand.phase === "go") {
    const dx = errand.x - play.x, dy = errand.y - play.y;
    const dist = Math.hypot(dx, dy);
    const step = 9 / UNIT;
    if (dist <= step) {
      play.x = errand.x; play.y = errand.y;
      errand.phase = "do";
      errand.until = frame + between(ERRAND_FRAMES[errand.kind]);
    } else {
      play.x += (dx / dist) * step;
      play.y += (dy / dist) * step;
    }
  } else if (frame >= errand.until ||
             (errand.kind === "sun" && readings.cpuLoad < HOT_CPU)) {   // the sun went in
    play.errand = null;
    play.nextErrand = frame + between([40, 100]);
  }
}

function advanceKittenPlay(play, readings) {
  // distances are scene pixels of the 720x360 scene, so play looks alike in every style
  const minX = 24 / UNIT, maxX = sceneW - 24 / UNIT;
  const minY = ART.playTop, maxY = sceneH - 18 / UNIT;
  const still = 1 / UNIT;
  play.ballX += play.ballVX;
  play.ballY += play.ballVY;
  play.ballVX *= 0.72;
  play.ballVY *= 0.72;
  if (Math.abs(play.ballVX) < still) play.ballVX = 0;
  if (Math.abs(play.ballVY) < still) play.ballVY = 0;
  if (play.ballX < minX) { play.ballX = minX; play.ballVX = Math.abs(play.ballVX); }
  if (play.ballX > maxX) { play.ballX = maxX; play.ballVX = -Math.abs(play.ballVX); }
  if (play.ballY < minY) { play.ballY = minY; play.ballVY = Math.abs(play.ballVY); }
  if (play.ballY > maxY) { play.ballY = maxY; play.ballVY = -Math.abs(play.ballVY); }
  if (play.errand) { runErrand(play, readings); return; }
  if (play.nextErrand === undefined) play.nextErrand = frame + between([15, 45]);
  if (frame >= play.nextErrand && Math.random() < 0.2) {
    play.errand = chooseErrand(play, readings);
    if (play.errand) return;
  }
  const dx = play.ballX - play.x;
  const dy = play.ballY - play.y;
  const dist = Math.hypot(dx, dy) || 1;
  if (dist > 16 / UNIT) {
    const step = Math.min(9 / UNIT, dist);
    play.x += (dx / dist) * step;
    play.y += (dy / dist) * step;
    play.x = Math.min(maxX, Math.max(minX, play.x));
    play.y = Math.min(maxY, Math.max(minY, play.y));
  } else if (!play.ballVX && !play.ballVY) {
    const angle = Math.random() * Math.PI * 2;      // WHACK
    const power = (18 + Math.random() * 26) / UNIT;
    play.ballVX = Math.cos(angle) * power;
    play.ballVY = Math.sin(angle) * power * 0.5;
  }
}

// ------------------------------------------------------------ spots & cats
function kittenLabel(kitten) {
  const title = (kitten.title || "").trim();
  if (title && !/^you are /i.test(title)) return title;
  return "⑂ " + kitten.id.replace(/^agent-/, "").slice(0, 7);
}

function drawAdoptionRuns() {
  // Departing cats wait asleep on their tree until the man collects them —
  // the tree only vanishes once the cat is in his arms.
  for (const waiting of adoptionRuns) {
    if (waiting.type === "depart" && waiting.phase === "in" && waiting.ghost) {
      ART.drawTree(pen, waiting.ghost.spot, waiting.accent, frame, 0);
      ART.drawCat(pen, waiting.ghost.spot, waiting.accent,
        {status: "idle", laptop: null}, frame);
    }
  }
  // There is only one adoption man; ceremonies queue and he handles them
  // one at a time. Queued arrivals stay hidden until he delivers them.
  const run = adoptionRuns[0];
  if (!run) return;
  const speed = 20 / UNIT;
  const offstage = 40 / UNIT;
  if (run.x === null) run.x = run.type === "arrive" ? -offstage : sceneW + offstage;
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
    if (run.x < -60 / UNIT || run.x > sceneW + 60 / UNIT) {
      if (run.type === "arrive") hiddenCatIds.delete(run.id);
      adoptionRuns.shift();
      return;
    }
  }
  const carrying = run.type === "arrive" ? run.phase === "in"
                                         : run.phase === "out";
  // arrivals come in from the left and leave that way; departures from the right
  const heading = (run.type === "arrive") === (run.phase === "in") ? 1 : -1;
  ART.drawMan(pen, run.x, frame, carrying ? run.accent : null, heading);
}

const lastStatusById = new Map();
const startledUntil = new Map();
const previousPendingById = new Map();
const taskFlashUntil = new Map();

function seedFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function drawSpotWithCat(slot, session, now, workingKittens) {
  if (!session) return;
  const spot = spots[slot];
  const accent = accentFor(session.id);
  const status = sessionStatus(session, now);
  ART.drawTree(pen, spot, accent, frame, workingKittens);
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
  const settled = status !== "idle" && !startled;
  ART.drawCat(pen, spot, accent, {
    status, startled, waiting, raisingHand,
    blink: settled && (frame + seed) % 13 === 0,       // blink ~every 4s
    // never turn away while waiting
    turned: settled && !waiting && !raisingHand && Math.floor((frame + seed) / 26) % 2 === 1,
    // coffee break: the mug is raised for a sip every so often
    sipping: waiting && ((frame + seed + 10) % 20) < 2,
    laptop: waiting ? "spinner" :
      raisingHand ? "open" :
      status === "working" ? "lit" :
      status === "thinking" ? "open" : "closed",
    pending: session.pending_tasks,
    flash: (taskFlashUntil.get(session.id) || 0) > frame,
  }, frame);
}

function workingKittensOf(data, sessionId) {
  return kittensOf(data, sessionId).filter((kitten) =>
    sessionStatus(kitten, data.generated_at) === "working").length;
}

function drawScene() {
  context.clearRect(0, 0, sceneW, sceneH);
  const data = latestData;
  const latest = data && data.history.length
    ? data.history[data.history.length - 1] : null;
  const cpuLoad = latest && data.cpu_count
    ? (latest.total / data.cpu_count) * 100 : 0;
  const readings = {cpuLoad, docker: data ? data.docker : [], gpu: data ? data.gpu : null};
  ART.drawBackdrop(pen, sceneW, frame, readings);
  const now = data ? data.generated_at : 0;
  const bySlot = new Map();
  if (data) for (const session of data.sessions) {
    const slot = spotBySession.get(session.id);
    if (slot !== undefined) bySlot.set(slot, session);
  }
  for (let slot = 0; slot < spots.length; slot++) {
    const session = bySlot.get(slot) || null;
    drawSpotWithCat(slot, session, now, session ? workingKittensOf(data, session.id) : 0);
  }
  if (data) for (const session of data.sessions) {
    const slot = spotBySession.get(session.id);
    if (slot === undefined || hiddenCatIds.has(session.id)) continue;
    const kittens = kittensOf(data, session.id);
    let workingSlot = 0;
    kittens.forEach((kitten, index) => {
      const accent = accentFor(session.id);
      const working = sessionStatus(kitten, now) === "working";
      const place = ART.kittenPlace(spots[slot], working ? workingSlot++ : index);
      const yarnColor = KITTEN_YARN_COLORS[index % KITTEN_YARN_COLORS.length];
      if (working) {
        kittenPlay.delete(kitten.id);
        ART.drawKittenWorking(pen, place, accent, frame, index, yarnColor);
      } else {
        let play = kittenPlay.get(kitten.id);
        if (!play) {
          play = {x: place.centerX, y: place.bottom,
                  ballX: place.centerX + 22 / UNIT, ballY: place.bottom + 14 / UNIT,
                  ballVX: 0, ballVY: 0};
          kittenPlay.set(kitten.id, play);
        }
        advanceKittenPlay(play, readings);
        ART.drawKittenPlaying(pen, play, accent, frame, yarnColor);
      }
    });
  }
  drawAdoptionRuns();
}

// ------------------------------------------------------------ overlays (DOM text)
function sceneScale() {
  const box = canvas.getBoundingClientRect();
  return Math.min(box.width / sceneW, box.height / sceneH);
}

function scenePosition(x, y) {
  const box = canvas.getBoundingClientRect();
  const scale = sceneScale();
  const offsetX = (box.width - sceneW * scale) / 2;
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

function shortenDetail(text) {
  // when the whole detail is a lone filesystem path, show just the filename —
  // "/Users/decker/…/session.py" is noise; "session.py" is the useful part.
  // (the hover card still carries the full path.)
  const trimmed = text.trim();
  if (trimmed && !/\s/.test(trimmed) && trimmed.includes("/")
      && !trimmed.includes("://")) {
    const name = trimmed.replace(/\/+$/, "").split("/").pop();
    if (name) return name;
  }
  return text;
}

function bubbleHtml(event, status) {
  if (status === "idle") return `<span class="icon">\u{1F4A4}</span>zzz`;
  if (!event) return "";
  const icon = TOOL_ICONS[event.tool] || "⚙️";
  const detail = event.detail ? shortenDetail(event.detail) : event.tool;
  return `<span class="icon">${icon}</span>${escapeHtml(detail)}`;
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
  // text is sized against the 720x360 scene, whatever the style's own pixel size
  const textScale = scale / UNIT;
  const bubbleFont = Math.max(9, Math.min(12, 11 * textScale));
  // a bubble may fill at most its cat's equal share of the floor width
  const bandScreen = Math.round((sceneW / Math.max(1, spots.length)) * scale) - 12;
  const bubbleSize = `font-size:${bubbleFont.toFixed(1)}px;` +
    `max-width:${Math.max(90, Math.min(300, bandScreen))}px;`;
  const miniBubbleSize = `font-size:${bubbleFont.toFixed(1)}px;` +
    `max-width:${Math.max(80, Math.min(170, bandScreen))}px;`;
  const nameFont = `font-size:${Math.max(8, Math.min(12, 11 * textScale)).toFixed(1)}px;`;
  const pieces = [];
  for (const session of data.sessions) {
    const slot = spotBySession.get(session.id);
    if (slot === undefined || hiddenCatIds.has(session.id)) continue;
    const spot = spots[slot];
    const status = sessionStatus(session, now);
    const anchors = ART.catAnchors(spot, status === "idle");
    const namePosition = scenePosition(anchors.nameX, anchors.nameY);
    const content = bubbleContentFor(session, status, now);
    // Family bubble stack: parent bubble at its head, kitten bubbles flowing
    // DOWNWARD in discrete one-line slots, alternating left/right columns.
    const parentPosition = scenePosition(anchors.x, anchors.bubbleY);
    if (content)
      pieces.push(`<div class="bubble ${status === "idle" ? "zzz" : ""}"` +
        ` style="left:${parentPosition.left}px;top:${parentPosition.top}px;${bubbleSize}">` +
        `${content}</div>`);
    const catHover = hoverData(session, now);
    const catBox = scenePosition(anchors.hover.x0, anchors.hover.y0);
    const catBoxEnd = scenePosition(anchors.hover.x1, anchors.hover.y1);
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
      const place = ART.kittenPlace(spot, working ? workingSlot++ : index);
      const play = kittenPlay.get(kitten.id);
      const kittenBox = ART.kittenHover(play ? play.x : place.centerX,
        play ? play.y : place.bottom);
      const kittenHover = hoverData(kitten, now);
      const hoverBox = scenePosition(kittenBox.x0, kittenBox.y0);
      const hoverBoxEnd = scenePosition(kittenBox.x1, kittenBox.y1);
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
        const bubbleAt = ART.kittenBubble(place);
        const anchor = scenePosition(bubbleAt.x, bubbleAt.y);
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
  const board = ART.boardText(sceneW);
  const boardTopLeft = scenePosition(board.x0, board.y0);
  const boardBottomRight = scenePosition(board.x1, board.y1);
  const boardWidth = boardBottomRight.left - boardTopLeft.left;
  const fontPx = Math.max(8, Math.round(boardWidth / 34));
  pieces.push(`<div class="board-text" style="left:${boardTopLeft.left}px;` +
    `top:${boardTopLeft.top}px;width:${boardWidth}px;` +
    `height:${boardBottomRight.top - boardTopLeft.top}px;font-size:${fontPx}px">` +
    `<div class="board-title">TODAY'S SPECIALS (${commands.length})</div>` +
    commands.slice(0, 4).map((c) => `<div>▸ ${escapeHtml(c)}</div>`).join("") +
    `</div>`);
  if (!data.sessions.length)
    pieces.push(`<div class="empty-office">The cafe is empty — no ` +
      (gladeFeed ? "active tasks." : "cats working in the last 15 minutes.") + `</div>`);
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
  if (gladeFeed) {
    // Glade's panel header carries the count; the corner only speaks up while
    // the feed isn't live.
    document.getElementById("corner").hidden = true;
    return;
  }
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


function trackAdoptions(cats) {
  const currentInfo = new Map();
  for (const cat of cats) {
    const slot = spotBySession.get(cat.id);
    if (slot === undefined || !spots[slot]) continue;
    currentInfo.set(cat.id, {x: ART.catAnchors(spots[slot], false).x,
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
  // Glade hands the plugin's style setting over with its data
  if (data.style) useStyle(data.style);
  fitSceneToViewport();
  const cats = data.sessions.filter((s) => !s.parent_id);
  // Freeze the layout while a departure is pending (or detected this cycle):
  // the man collects the cat from the arrangement as-it-was; the remaining
  // trees only re-spread once the ceremony is over.
  const liveIds = new Set(cats.map((cat) => cat.id));
  const departureDetected = knownCatInfo !== null &&
    [...knownCatInfo.keys()].some((id) => !liveIds.has(id));
  const departurePending = adoptionRuns.some((run) => run.type === "depart");
  if (!departureDetected && !departurePending) {
    spots = ART.spots(cats.length, sceneW);
    assignSpots(cats);
  }
  for (const [sessionId, slot] of spotBySession)
    // one kitten slot per level, so the post grows with the litter
    if (spots[slot])
      spots[slot].post = ART.postFor(workingKittensOf(data, sessionId));
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
  if (gladeFeed) return;
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
    // Tell the wrapper this frame is alive and rendering. If these stop
    // arriving the wrapper reloads us — the iframe's content process can be
    // evicted or crash while the server stays perfectly healthy, and nothing
    // else would notice.
    try {
      if (window.parent !== window)
        window.parent.postMessage({type: "catCafeAlive"}, "*");
    } catch (error) {}
  }
});

async function refresh() {
  if (gladeFeed) return;
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
window.addEventListener("resize", () => {
  const widthChanged = fitSceneToViewport();
  if (!latestData) return;
  if (widthChanged) apply(latestData); else renderOverlay(latestData);
});
document.documentElement.dataset.style = ART.id;
useStyle(requestedStyle());
fitSceneToViewport();
if (typeof BOOTSTRAP === "object" && BOOTSTRAP) apply(BOOTSTRAP);
drawScene();
refresh();

// Glade pushes events as things change; each one re-renders straight away,
// like the VS Code push path, and the pump below re-renders once a second so
// ages and bubbles move on between events.
const gladeLink = gladeFeed ? gladeFeed.connect(window, (data) => {
  consume(data, "glade");
  frame++;
  drawScene();
}) : null;
if (gladeFeed && !gladeLink) {
  // opened outside Glade: there's nothing to listen to
  document.getElementById("corner").classList.add("stale");
  document.getElementById("corner-text").textContent = "disconnected";
}

// Drive animation and polling from requestAnimationFrame, not setInterval:
// Chromium throttles interval timers in webview iframes (sometimes to minutes),
// but rAF always runs while the page is actually visible.
let lastFrameAt = 0;
let lastRefreshAt = 0;
function pump(now) {
  if (now - lastFrameAt >= 320) { lastFrameAt = now; frame++; drawScene(); }
  if (now - lastRefreshAt >= 1000) {
    lastRefreshAt = now;
    if (gladeLink) gladeLink.tick(); else refresh();
  }
  requestAnimationFrame(pump);
}
requestAnimationFrame(pump);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
// Low-frequency backstop in case rAF is ever suspended while still visible.
setInterval(() => { if (gladeLink) gladeLink.tick(); else refresh(); }, 10000);

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
