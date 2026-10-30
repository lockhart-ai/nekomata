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
// The scene is two layers: the room on the bottom canvas, and everything in it (trees,
// cats, kittens, the adoption man) on a second one above the overlay's chalkboard text, so
// a cat in front of the board covers the board's writing too.
const actorsCanvas = document.getElementById("actors");
const actorsContext = actorsCanvas.getContext("2d");
// what a style draws onto: the layer drawScene has picked
const pen = {
  layer: context,
  rect(x, y, w, h, color) { this.layer.fillStyle = color; this.layer.fillRect(x, y, w, h); },
};

function sizeCanvases(width, height) {
  for (const layer of [canvas, actorsCanvas]) { layer.width = width; layer.height = height; }
}

// ------------------------------------------------------------ keyboard focus outline
// A style (web/art/*.js) draws a cat as several solid-colour rects through `pen`/`g`; a
// turned cat's rects still go through the same pen object (mirrored() just redirects the
// coordinates, see 16bit.js/32bit.js), so wrapping pen.rect here sees every style's cat and
// kitten, turned or not, with no changes to web/art/*.js at all.
function isTranslucent(color) {
  const match = /^rgba\([^)]*,\s*([\d.]+)\s*\)$/.exec(color);
  return !!match && Number(match[1]) < 1;
}

/** Runs `draw` recording every pixel it fills (skipping soft/translucent fills, like a
 *  shadow, so the outline hugs the sprite and not a shadow's blur), then traces a 1px white
 *  contour around that silhouette on the same layer draw used — the focused cat's outline. */
function withFocusOutline(draw) {
  const cells = new Set();
  const plain = pen.rect;
  pen.rect = function (x, y, w, h, color) {
    plain.call(pen, x, y, w, h, color);
    if (isTranslucent(color)) return;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.ceil(x + w), y1 = Math.ceil(y + h);
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0; xx < x1; xx++) cells.add(xx + "," + yy);
  };
  try { draw(); } finally { pen.rect = plain; }
  pen.layer.fillStyle = "#fffdf7";
  for (const key of cells) {
    const at = key.indexOf(",");
    const x = Number(key.slice(0, at)), y = Number(key.slice(at + 1));
    if (!cells.has((x - 1) + "," + y)) pen.layer.fillRect(x - 1, y, 1, 1);
    if (!cells.has((x + 1) + "," + y)) pen.layer.fillRect(x + 1, y, 1, 1);
    if (!cells.has(x + "," + (y - 1))) pen.layer.fillRect(x, y - 1, 1, 1);
    if (!cells.has(x + "," + (y + 1))) pen.layer.fillRect(x, y + 1, 1, 1);
  }
}

// Whether `id` (a session or kitten id) should be drawn with the outline right now.
function focusedThis(id) { return overlayHasFocus && rovingId === id; }

function fitSceneToViewport() {
  // Widen the scene to the viewport's aspect ratio; the style lays its room
  // out for whatever width it's given.
  const box = canvas.getBoundingClientRect();
  if (!box.width || !box.height) return false;
  const wanted = Math.min(SCENE_W_MAX,
    Math.max(SCENE_W, Math.round(sceneH * box.width / box.height)));
  if (wanted === sceneW) return false;
  sceneW = wanted;
  sizeCanvases(sceneW, sceneH);
  // the room's bowls, plant and sunbeam moved with the width: errands start over
  for (const play of kittenPlay.values()) play.errand = null;
  return true;
}
const overlay = document.getElementById("overlay");
// The keyboard/hover targets live in their own sibling layer, not inside #overlay: that one
// is rebuilt (innerHTML) every second for the bubbles and nametags, which would tear down
// and recreate a focused target each time — exactly what loses screen-reader focus.
const hoverTargets = document.getElementById("hover-targets");
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

// ------------------------------------------------------------ keyboard navigation
// Session/kitten id → its persistent hover-target element (see hoverTargets above): the
// same node for as long as that cat/kitten is on the floor, so focusing it never looks like
// a new element to a screen reader.
const hoverTargetBySid = new Map();
let rovingId = null;          // which id owns tabindex="0" (WAI-ARIA roving tabindex)
let overlayHasFocus = false;  // a hover-target has focus
const HINT_KEYS = "asdfghjklqwertyuiopzxcvbnm";
let hintsActive = false;
let hintContainer = null;

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
  sizeCanvases(sceneW, sceneH);
  document.documentElement.dataset.style = ART.id;
  // Positions are in the old style's pixels: start the floor over, with no
  // ceremonies for cats that were already here.
  spots = [];
  spotBySession.clear();
  kittenPlay.clear();
  adoptionRuns = [];
  hiddenCatIds.clear();
  knownCatInfo = null;
  for (const el of hoverTargetBySid.values()) el.remove();
  hoverTargetBySid.clear();
  rovingId = null; overlayHasFocus = false;
  dismissHints();
  return true;
}

// Themes (web/art/themes/) dress a style's cafe for a season; only styles with a setTheme
// have any. "default" is the everyday cafe, "seasonal" follows the date, or a theme by id.
// Each season is [theme, from month, from day, to month, to day], first match wins; together
// they cover the whole year, so "seasonal" always has a theme.
const SEASONS = [
  ["christmas", 12, 1, 1, 6],
  ["winter", 1, 7, 3, 19],
  ["halloween", 10, 15, 10, 31],
  ["autumn", 9, 1, 11, 30],
  ["spring", 3, 20, 5, 31],
  ["summer", 6, 1, 8, 31],
];
let themeChoice = "seasonal";

function seasonalTheme(date) {
  const day = (date.getMonth() + 1) * 100 + date.getDate();
  for (const [id, fromMonth, fromDay, toMonth, toDay] of SEASONS) {
    const from = fromMonth * 100 + fromDay, to = toMonth * 100 + toDay;
    if (from <= to ? day >= from && day <= to : day >= from || day <= to) return id;
  }
  return "default";   // unreachable while the seasons cover the year
}

function applyTheme() {
  if (!ART.setTheme) return;
  const id = themeChoice === "seasonal" ? seasonalTheme(new Date()) : themeChoice;
  ART.setTheme(id);   // an id the style doesn't have, "default" included, is the everyday cafe
}

function requestedTheme() {
  try { return new URLSearchParams(location.search).get("theme"); } catch (error) { return null; }
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
  // the sun coming out is worth getting up for: a playing kitten heads for it soon after
  const hot = readings.cpuLoad >= HOT_CPU;
  if (hot && !play.sawSun) play.nextErrand = Math.min(play.nextErrand, frame + between([2, 15]));
  play.sawSun = hot;
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

function drawAdoptionRuns(advance) {
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
  // A keyboard-only repaint (advance=false) must not step the ceremony along — it just
  // redraws the man at wherever he already is this frame.
  if (advance) {
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
  const drawCat = () => ART.drawCat(pen, spot, accent, {
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
    // the same number for this cat every time, for whatever a style picks per cat
    seed,
  }, frame);
  if (focusedThis(session.id)) withFocusOutline(drawCat); else drawCat();
}

function workingKittensOf(data, sessionId) {
  return kittensOf(data, sessionId).filter((kitten) =>
    sessionStatus(kitten, data.generated_at) === "working").length;
}

function drawScene(advance = true) {
  context.clearRect(0, 0, sceneW, sceneH);
  actorsContext.clearRect(0, 0, sceneW, sceneH);
  pen.layer = context;
  const data = latestData;
  const latest = data && data.history.length
    ? data.history[data.history.length - 1] : null;
  const cpuLoad = latest && data.cpu_count
    ? (latest.total / data.cpu_count) * 100 : 0;
  const readings = {cpuLoad, docker: data ? data.docker : [], gpu: data ? data.gpu : null};
  ART.drawBackdrop(pen, sceneW, frame, readings);
  pen.layer = actorsContext;                    // the rest stands in front of the board's text
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
        const draw = () => ART.drawKittenWorking(pen, place, accent, frame, index, yarnColor);
        if (focusedThis(kitten.id)) withFocusOutline(draw); else draw();
      } else {
        let play = kittenPlay.get(kitten.id);
        if (!play) {
          play = {x: place.centerX, y: place.bottom,
                  ballX: place.centerX + 22 / UNIT, ballY: place.bottom + 14 / UNIT,
                  ballVX: 0, ballVY: 0};
          kittenPlay.set(kitten.id, play);
        }
        // A keyboard-only repaint (advance=false) must not step the kitten's play along —
        // it just redraws it at wherever it already is this frame.
        if (advance) advanceKittenPlay(play, readings);
        const draw = () => ART.drawKittenPlaying(pen, play, accent, frame, yarnColor);
        if (focusedThis(kitten.id)) withFocusOutline(draw); else draw();
      }
    });
  }
  drawAdoptionRuns(advance);
  if (ART.drawForeground) ART.drawForeground(pen, sceneW, frame);
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
  const seenSids = new Set();
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
    syncHoverTarget(session.id, {
      task: session.id, subagent: null, name: sessionName(session),
      when: catHover.when, message: catHover.message,
      box: {left: catBox.left, top: catBox.top,
            width: catBoxEnd.left - catBox.left, height: catBoxEnd.top - catBox.top},
    });
    seenSids.add(session.id);
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
      syncHoverTarget(kitten.id, {
        task: session.id, subagent: kitten.id, name: "⑂ " + kittenLabel(kitten),
        when: kittenHover.when, message: kittenHover.message,
        box: {left: hoverBox.left, top: hoverBox.top,
              width: hoverBoxEnd.left - hoverBox.left, height: hoverBoxEnd.top - hoverBox.top},
      });
      seenSids.add(kitten.id);
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
  // A cat/kitten that left the floor (adopted out, or its parent gone) loses its target —
  // real focus loss, not the per-second kind this layer exists to avoid.
  for (const [sid, el] of hoverTargetBySid)
    if (!seenSids.has(sid)) {
      el.remove();
      hoverTargetBySid.delete(sid);
      if (rovingId === sid) { rovingId = null; overlayHasFocus = false; }
    }
  applyRovingTabindex();
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

// ------------------------------------------------------------ keyboard/hover targets
// Gets (or makes) sid's persistent hover-target element and brings its position and content
// up to date in place — never recreated while the cat/kitten is on the floor, so a focused
// one keeps the same element across every per-second rebuild (see #hover-targets in
// styles.css).
function syncHoverTarget(sid, info) {
  let el = hoverTargetBySid.get(sid);
  if (!el) {
    el = document.createElement("div");
    el.className = "hover-target";
    el.setAttribute("tabindex", "-1");
    hoverTargets.appendChild(el);
    hoverTargetBySid.set(sid, el);
  }
  el.style.left = info.box.left + "px";
  el.style.top = info.box.top + "px";
  el.style.width = info.box.width + "px";
  el.style.height = info.box.height + "px";
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", info.name);
  el.dataset.sid = sid;
  el.dataset.task = info.task;
  if (info.subagent) el.dataset.subagent = info.subagent; else delete el.dataset.subagent;
  el.dataset.name = info.name;
  el.dataset.when = info.when;
  el.dataset.message = info.message;
}

// WAI-ARIA roving tabindex: exactly one hover-target is a Tab stop at a time, so the whole
// group is a single stop; arrow keys move which one that is.
function applyRovingTabindex() {
  const targets = [...hoverTargetBySid.values()];
  if (!targets.length) { rovingId = null; return; }
  let found = false;
  for (const el of targets) {
    if (el.dataset.sid === rovingId) { el.setAttribute("tabindex", "0"); found = true; }
    else el.setAttribute("tabindex", "-1");
  }
  if (!found) {
    targets[0].setAttribute("tabindex", "0");
    rovingId = targets[0].dataset.sid;
  }
}

function centerOf(el) {
  const box = el.getBoundingClientRect();
  return {x: box.left + box.width / 2, y: box.top + box.height / 2};
}

// Moves the roving target to whichever other one is nearest in `direction` on screen (not
// DOM order), penalizing cross-axis distance so a slightly-staggered row still feels like a
// straight line. Focusing it is what actually moves rovingId/tabindex along — see focusin.
function rovingMove(direction) {
  const current = hoverTargetBySid.get(rovingId);
  if (!current) return;
  const origin = centerOf(current);
  let best = null, bestDist = Infinity;
  for (const el of hoverTargetBySid.values()) {
    if (el === current) continue;
    const c = centerOf(el);
    const dx = c.x - origin.x, dy = c.y - origin.y;
    let inDirection = false;
    if (direction === "left") inDirection = dx < -8;
    if (direction === "right") inDirection = dx > 8;
    if (direction === "up") inDirection = dy < -8;
    if (direction === "down") inDirection = dy > 8;
    if (!inDirection) continue;
    const primary = (direction === "left" || direction === "right") ? Math.abs(dx) : Math.abs(dy);
    const cross = (direction === "left" || direction === "right") ? Math.abs(dy) : Math.abs(dx);
    const dist = primary + cross * 2;
    if (dist < bestDist) { bestDist = dist; best = el; }
  }
  if (!best) return;
  best.focus({preventScroll: true});
}

// ------------------------------------------------------------ vimium-style hints
function refreshHints() {
  if (hintContainer) { hintContainer.remove(); hintContainer = null; }
  if (!hintsActive) return;
  const targets = [...hoverTargetBySid.values()];
  if (!targets.length) { hintsActive = false; return; }
  hintContainer = document.createElement("div");
  hintContainer.id = "hint-overlay";
  hintContainer.setAttribute("aria-live", "polite");
  hintContainer.setAttribute("aria-label", "Keyboard hints active. Press a letter to jump to a cat.");
  hoverTargets.appendChild(hintContainer);   // position:fixed — the parent doesn't matter
  targets.forEach((target, i) => {
    if (i >= HINT_KEYS.length) return;
    const key = HINT_KEYS[i];
    const box = target.getBoundingClientRect();
    const hint = document.createElement("span");
    hint.className = "hint-badge";
    hint.textContent = key.toUpperCase();
    hint.style.left = (box.left + box.width / 2) + "px";
    hint.style.top = (box.top + box.height / 2) + "px";
    hintContainer.appendChild(hint);
  });
}

function showHints() { hintsActive = true; refreshHints(); }
function dismissHints() { hintsActive = false; refreshHints(); }

function activateHint(key) {
  const targets = [...hoverTargetBySid.values()];
  const index = HINT_KEYS.indexOf(key);
  if (index < 0 || index >= targets.length) return;
  dismissHints();
  targets[index].focus({preventScroll: true});
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
  // Glade hands the plugin's style and theme settings over with its data
  if (data.style) useStyle(data.style);
  if (data.theme) themeChoice = data.theme;
  applyTheme();
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
themeChoice = requestedTheme() || themeChoice;
applyTheme();
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

// Hover, or keyboard-focus, a cat or kitten to see its full last message.
const hovercard = document.getElementById("hovercard");
function showHovercard(target) {
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
}
// The hover-target elements are now the keyboard/hover layer's own children (see
// #hover-targets), not #overlay's — these are the same listeners, just moved to where the
// targets live; mouse behaviour (what fires, and when) is unchanged.
hoverTargets.addEventListener("mouseover", (event) => {
  const target = event.target.closest(".hover-target");
  if (target) showHovercard(target);
});
// In Glade, clicking a cat opens its task, and a kitten its subagent in that task. The
// overlay is rebuilt every second, so the element pressed may be gone by the release; the
// release is what counts, on whichever cat is under the pointer then.
hoverTargets.addEventListener("pointerup", (event) => {
  if (!gladeLink || event.button !== 0) return;
  const target = event.target.closest(".hover-target");
  if (target && target.dataset.task)
    gladeLink.open(target.dataset.task, target.dataset.subagent || null);
});
hoverTargets.addEventListener("mouseout", (event) => {
  if (event.target.closest(".hover-target")) hovercard.style.display = "none";
});

// ------------------------------------------------------------ keyboard navigation
hoverTargets.addEventListener("focusin", (event) => {
  const el = event.target;
  if (!el || !el.dataset || !el.dataset.sid) return;
  rovingId = el.dataset.sid;
  overlayHasFocus = true;
  applyRovingTabindex();
  showHovercard(el);
  drawScene();
});
hoverTargets.addEventListener("focusout", () => {
  overlayHasFocus = false;
  hovercard.style.display = "none";
  drawScene();
});

document.addEventListener("keydown", (event) => {
  const eventTarget = event.target;
  if (eventTarget && (eventTarget.tagName === "INPUT" || eventTarget.tagName === "TEXTAREA")) return;
  if (hintsActive) {
    // Only Escape or an actual hint letter is ours to take: Tab, a modifier shortcut
    // (Cmd/Ctrl/Alt) and anything else passes through untouched.
    if (event.key === "Escape") { event.preventDefault(); dismissHints(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey || event.key === "Tab") return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : "";
    if (key && HINT_KEYS.includes(key)) { event.preventDefault(); activateHint(key); }
    return;
  }
  const dirMap = {ArrowRight: "right", ArrowLeft: "left", ArrowUp: "up", ArrowDown: "down"};
  if (overlayHasFocus && dirMap[event.key]) { event.preventDefault(); rovingMove(dirMap[event.key]); return; }
  // f jumps into the group with a letter hint on each target — not while already in it.
  if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey &&
      !overlayHasFocus) {
    event.preventDefault();
    showHints();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    const current = hoverTargetBySid.get(rovingId);
    if (current) current.blur();
  }
});
