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
// vimium-style keyboard hint state
const HINT_KEYS = "asdfghjklqwertyuiopzxcvbnm";
let hintsActive = false;
let hintContainer = null;
// roving tabindex: track which cat/kitten owns tabindex="0"
let rovingSid = null;
let overlayHasFocus = false;

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

function drawSpriteOutline(rows, x, y, scale) {
  const color = "#fffdf7";
  const h = rows.length, w = rows[0].length;
  const solid = (r, c) => r >= 0 && r < h && c >= 0 && c < w && rows[r][c] !== ".";
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (rows[r][c] !== ".") continue;
      if (solid(r - 1, c) || solid(r + 1, c) || solid(r, c - 1) || solid(r, c + 1))
        rect(x + c * scale, y + r * scale, scale, scale, color);
    }
  }
  for (let r = 0; r < h; r++) {
    if (rows[r][0] !== ".") rect(x - scale, y + r * scale, scale, scale, color);
    if (rows[r][w - 1] !== ".") rect(x + w * scale, y + r * scale, scale, scale, color);
  }
  for (let c = 0; c < w; c++) {
    if (rows[0][c] !== ".") rect(x + c * scale, y - scale, scale, scale, color);
    if (rows[h - 1][c] !== ".") rect(x + c * scale, y + h * scale, scale, scale, color);
  }
}

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
  const spriteX = geometry.catCenterX - 24 + shake;
  const spriteY = geometry.catBottom - rows.length * 3 + bob;
  if (overlayHasFocus && rovingSid === session.id)
    drawSpriteOutline(rows, spriteX, spriteY, 3);
  drawBitmap(rows, spriteX, spriteY, 3,
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
        const kx = place.centerX - 12;
        const ky = place.bottom - KITTEN.length * 3 + (frame % 2 ? 2 : 0);
        if (overlayHasFocus && rovingSid === kitten.id)
          drawSpriteOutline(KITTEN, kx, ky, 3);
        drawBitmap(KITTEN, kx, ky, 3, kittenColors);
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
        const kx = play.x - 12;
        const ky = play.y - KITTEN.length * 3 + (frame % 2 ? 1 : 0);
        if (overlayHasFocus && rovingSid === kitten.id)
          drawSpriteOutline(KITTEN, kx, ky, 3);
        drawBitmap(KITTEN, kx, ky, 3, kittenColors);
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
    pieces.push(`<div class="hover-target" tabindex="-1"` +
      ` role="button" aria-label="${escapeHtml(sessionName(session))}"` +
      ` data-sid="${escapeHtml(session.id)}"` +
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
      pieces.push(`<div class="hover-target" tabindex="-1"` +
        ` role="button" aria-label="⑂ ${escapeHtml(kittenLabel(kitten))}"` +
        ` data-sid="${escapeHtml(kitten.id)}"` +
        (working ? "" : ` data-kitten-id="${escapeHtml(kitten.id)}"`) +
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
  const focusedTarget = document.activeElement?.closest(".hover-target");
  const focusedSid = focusedTarget?.dataset.sid;
  overlay.innerHTML = pieces.join("");
  applyRovingTabindex();
  if (focusedSid) {
    const restored = overlay.querySelector(
      `.hover-target[data-sid="${CSS.escape(focusedSid)}"]`);
    if (restored) restored.focus({preventScroll: true});
  }
  clampBubblesToView();
  resolveBubbleCollisions();
  refreshHints();
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
function updateMovingTargets() {
  for (const target of overlay.querySelectorAll("[data-kitten-id]")) {
    const play = kittenPlay.get(target.dataset.kittenId);
    if (!play) continue;
    const box = scenePosition(play.x - 14, play.y - 24);
    const boxEnd = scenePosition(play.x + 14, play.y + 4);
    target.style.left = box.left + "px";
    target.style.top = box.top + "px";
    target.style.width = (boxEnd.left - box.left) + "px";
    target.style.height = (boxEnd.top - box.top) + "px";
  }
  if (hintsActive) refreshHints();
}

function pump(now) {
  if (now - lastFrameAt >= 320) {
    lastFrameAt = now; frame++; drawScene(); updateMovingTargets();
  }
  if (now - lastRefreshAt >= 1000) { lastRefreshAt = now; refresh(); }
  requestAnimationFrame(pump);
}
requestAnimationFrame(pump);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
// Low-frequency backstop in case rAF is ever suspended while still visible.
setInterval(refresh, 10000);

// Hover or focus a cat/kitten to see its full last message.
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
overlay.addEventListener("mouseover", (event) => {
  const target = event.target.closest(".hover-target");
  if (target) showHovercard(target);
});
overlay.addEventListener("mouseout", (event) => {
  if (event.target.closest(".hover-target")) hovercard.style.display = "none";
});
// ------------------------------------------------------------ roving tabindex
function applyRovingTabindex() {
  const targets = overlay.querySelectorAll(".hover-target");
  if (!targets.length) return;
  let activeFound = false;
  for (const t of targets) {
    if (t.dataset.sid === rovingSid) {
      t.setAttribute("tabindex", "0");
      activeFound = true;
    } else {
      t.setAttribute("tabindex", "-1");
    }
  }
  if (!activeFound) {
    targets[0].setAttribute("tabindex", "0");
    rovingSid = targets[0].dataset.sid;
  }
}

function centerOf(el) {
  const r = el.getBoundingClientRect();
  return {x: r.left + r.width / 2, y: r.top + r.height / 2};
}

function rovingMove(direction) {
  const targets = [...overlay.querySelectorAll(".hover-target")];
  if (!targets.length) return;
  const currentIdx = targets.findIndex((t) => t.dataset.sid === rovingSid);
  if (currentIdx < 0) return;
  const origin = centerOf(targets[currentIdx]);
  let best = -1, bestDist = Infinity;
  for (let i = 0; i < targets.length; i++) {
    if (i === currentIdx) continue;
    const c = centerOf(targets[i]);
    const dx = c.x - origin.x, dy = c.y - origin.y;
    let inDirection = false;
    if (direction === "left")  inDirection = dx < -8;
    if (direction === "right") inDirection = dx > 8;
    if (direction === "up")    inDirection = dy < -8;
    if (direction === "down")  inDirection = dy > 8;
    if (!inDirection) continue;
    const primaryDist = (direction === "left" || direction === "right")
      ? Math.abs(dx) : Math.abs(dy);
    const crossDist = (direction === "left" || direction === "right")
      ? Math.abs(dy) : Math.abs(dx);
    const dist = primaryDist + crossDist * 2;
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  if (best < 0) return;
  rovingSid = targets[best].dataset.sid;
  for (const t of targets) t.setAttribute("tabindex", "-1");
  targets[best].setAttribute("tabindex", "0");
  targets[best].focus({preventScroll: true});
  drawScene();
}

// ------------------------------------------------------------ vimium-style hints
function refreshHints() {
  if (hintContainer) { hintContainer.remove(); hintContainer = null; }
  if (!hintsActive) return;
  const targets = [...overlay.querySelectorAll(".hover-target")];
  if (!targets.length) { hintsActive = false; return; }
  hintContainer = document.createElement("div");
  hintContainer.id = "hint-overlay";
  hintContainer.setAttribute("aria-live", "polite");
  hintContainer.setAttribute("aria-label",
    "Keyboard hints active. Press a letter to jump to a cat.");
  document.body.appendChild(hintContainer);
  targets.forEach((target, i) => {
    if (i >= HINT_KEYS.length) return;
    const key = HINT_KEYS[i];
    const box = target.getBoundingClientRect();
    const hint = document.createElement("span");
    hint.className = "hint-badge";
    hint.textContent = key.toUpperCase();
    hint.dataset.hintKey = key;
    hint.style.left = (box.left + box.width / 2) + "px";
    hint.style.top = (box.top + box.height / 2) + "px";
    hintContainer.appendChild(hint);
  });
}

function showHints() {
  hintsActive = true;
  refreshHints();
}

function dismissHints() {
  hintsActive = false;
  refreshHints();
}

function activateHint(key) {
  const targets = [...overlay.querySelectorAll(".hover-target")];
  const index = HINT_KEYS.indexOf(key);
  if (index >= 0 && index < targets.length) {
    dismissHints();
    rovingSid = targets[index].dataset.sid;
    applyRovingTabindex();
    targets[index].focus({preventScroll: true});
    drawScene();
  }
}

overlay.addEventListener("focusin", (event) => {
  const target = event.target.closest(".hover-target");
  if (target && target.dataset.sid) {
    rovingSid = target.dataset.sid;
    overlayHasFocus = true;
    applyRovingTabindex();
    showHovercard(target);
    drawScene();
  }
});
overlay.addEventListener("focusout", (event) => {
  if (event.target.closest(".hover-target")) {
    overlayHasFocus = false;
    hovercard.style.display = "none";
    drawScene();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") return;
  if (hintsActive) {
    event.preventDefault();
    if (event.key === "Escape") { dismissHints(); return; }
    const key = event.key.toLowerCase();
    if (HINT_KEYS.includes(key)) activateHint(key);
    return;
  }
  const inOverlay = event.target.closest(".hover-target");
  if (inOverlay) {
    const dirMap = {ArrowRight: "right", ArrowLeft: "left",
                    ArrowUp: "up", ArrowDown: "down"};
    if (dirMap[event.key]) {
      event.preventDefault(); rovingMove(dirMap[event.key]);
    }
  }
  if (event.key === "f" && !event.ctrlKey && !event.metaKey && !event.altKey && !inOverlay) {
    event.preventDefault();
    showHints();
  }
  if (event.key === "Escape") {
    hovercard.style.display = "none";
    document.activeElement?.blur();
  }
});
