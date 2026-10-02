"use strict";
// Nekomata's art, style "8bit": the original cat cafe. Flat single-colour sprites on a 3 px
// grid, drawn straight onto the 720x360 scene (one art pixel is one scene pixel).
//
// A style is everything the scene draws and where it puts it; web/app.js decides what
// happens (who is working, who is asleep, who the adoption man is carrying) and asks the
// style to draw it. Each style registers itself in NekomataArt under its id and offers:
//
//   px, width, height     scene pixels per art pixel, and the art's size at the base width
//   spots(count, w)       a cat tree per cat, for a scene `w` wide; app.js sets each .post
//   postFor(kittens)      how tall a tree's post is for that many working kittens
//   catAnchors(spot, asleep), kittenPlace(spot, index), kittenHover(x, y),
//   kittenBubble(place), boardText(w), playTop
//                         where the overlay's text and hover targets go, and where
//                         kittens sit and play
//   drawBackdrop, drawTree, drawCat, drawKittenWorking, drawKittenPlaying, drawMan
//                         the drawing itself, onto g.rect(x, y, w, h, color)
//
// All coordinates are in the style's own art pixels.
(function (root) {
const W = 720, H = 360, WALL_H = 92;

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


const catColors = (accent) =>
  ({S: accent, T: shade(accent), K: "#141412", P: "#f0937e", W: "#fffdf7"});

// ------------------------------------------------------------ pixel helpers
function drawBitmap(g, rows, x, y, scale, colors) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const key = rows[r][c];
      if (key === ".") continue;
      g.rect(x + c * scale, y + r * scale, scale, scale, colors[key]);
    }
  }
}


function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const dim = (v) => Math.max(0, Math.floor(v * 0.62));
  return "#" + [dim(n >> 16 & 255), dim(n >> 8 & 255), dim(n & 255)]
    .map((v) => v.toString(16).padStart(2, "0")).join("");
}


// ------------------------------------------------------------ room & props

function drawRoom(g, w) {
  g.rect(0, 0, w, WALL_H, "#f0d0ae");
  g.rect(0, 72, w, 20, "#ddab80");
  for (let sx = 0; sx < w; sx += 24) g.rect(sx, 74, 1, 18, "#cb9a70");
  g.rect(0, 72, w, 2, "#b98a5e");
  for (let ty = WALL_H; ty < H; ty += 18) {
    const plankRow = (ty - WALL_H) / 18;
    g.rect(0, ty, w, 18, plankRow % 2 ? "#c09678" : "#c89e80");
    g.rect(0, ty, w, 1, "#a87c62");
    for (let sx = (plankRow % 3) * 48; sx < w; sx += 144)
      g.rect(sx, ty + 1, 1, 17, "#a87c62");
  }
}

function drawBunting(g, w) {
  g.rect(0, 2, w, 2, "#b98a5e");
  const colors = ["#f2a0b8", "#a8d8c0", "#f7d64a", "#c3b2e2"];
  for (let i = 0; i < w / 26; i++) {
    const color = colors[i % colors.length];
    const bx = i * 26 + 6;
    g.rect(bx, 4, 12, 4, color); g.rect(bx + 2, 8, 8, 3, color); g.rect(bx + 4, 11, 4, 3, color);
  }
}

function drawHangingPlant(g, x) {
  g.rect(x + 8, 0, 4, 6, "#8a5f3c");
  g.rect(x, 6, 20, 10, "#c47a52"); g.rect(x + 2, 14, 16, 3, "#a05f3e");
  const vines = [[x + 3, 40], [x + 9, 26], [x + 15, 34]];
  for (const [vx, length] of vines) {
    g.rect(vx, 17, 2, length, "#2f7d33");
    for (let ly = 20; ly < 17 + length; ly += 8) {
      g.rect(vx - 3, ly, 3, 4, "#4aa64e");
      g.rect(vx + 2, ly + 4, 3, 4, "#3c9440");
    }
  }
}

function drawCake(g, x, y, color, busy, frame) {
  g.rect(x, y + 4, 18, 9, color);
  g.rect(x + 2, y, 14, 5, "#fff5ea");
  if (busy) {
    g.rect(x + 8, y - 4, 3, 4, frame % 2 ? "#ffd23e" : "#f28a3c");
    g.rect(x + 8, y - 6, 3, 2, "#fff5ea");
  } else {
    g.rect(x + 7, y - 3, 4, 4, "#e05a6a");
  }
}

const CASE_X = 170, CASE_Y = 16;
const CAKE_COLORS = ["#f2a0b8", "#a8d8a0", "#f7d64a", "#c3b2e2", "#f2b48a", "#a6dcf5"];

function drawCase(g, x, containers, frame) {
  const y = CASE_Y;
  g.rect(x - 4, y - 4, 128, 72, "#b98a5e");
  g.rect(x, y, 120, 62, "#faeedd");
  g.rect(x + 2, y + 26, 116, 3, "#d9bf9c");
  g.rect(x + 2, y + 52, 116, 3, "#d9bf9c");
  const slots = [[x + 10, y + 14], [x + 50, y + 14], [x + 90, y + 14],
                 [x + 10, y + 40], [x + 50, y + 40], [x + 90, y + 40]];
  slots.forEach(([cakeX, cakeY], index) => {
    const container = containers[index];
    if (container) drawCake(g, cakeX, cakeY, CAKE_COLORS[index], container.cpu >= 20, frame);
  });
  g.rect(x + 6, y + 3, 3, 56, "rgba(255,255,255,0.55)");
  g.rect(x - 4, y + 62, 128, 10, "#8a5f3c");
}

const WINDOW_X = 30, WINDOW_Y = 16;

function drawWindow(g, x, load, frame) {
  const y = WINDOW_Y;
  const hot = load >= 70, warm = load >= 35;
  g.rect(x - 4, y - 4, 128, 68, "#b98a5e");
  g.rect(x, y, 120, 60, hot ? "#f7c791" : "#a6dcf5");
  const cx = x + 17, cy = y + 17;
  const radius = hot ? 12 : warm ? 9 : 7;
  const sunColor = hot ? "#ff9d2e" : warm ? "#f7c93e" : "#f2dc8a";
  g.rect(cx - radius, cy - radius, radius * 2, radius * 2, sunColor);
  g.rect(cx - radius + 3, cy - radius + 3, radius * 2 - 6, radius * 2 - 6,
    hot ? "#ffd23e" : "#f7e39a");
  if (warm) {
    const ray = (hot ? 8 : 5) + (hot && frame % 2 ? 3 : 0);
    g.rect(cx - radius - 3 - ray, cy - 1, ray, 2, sunColor);
    g.rect(cx + radius + 3, cy - 1, ray, 2, sunColor);
    g.rect(cx - 1, cy - radius - 3 - ray, 2, ray, sunColor);
    g.rect(cx - 1, cy + radius + 3, 2, ray, sunColor);
  }
  if (hot) {
    const diagonal = radius + 4 + (frame % 2 ? 2 : 0);
    g.rect(cx - diagonal - 2, cy - diagonal - 2, 3, 3, sunColor);
    g.rect(cx + diagonal, cy - diagonal - 2, 3, 3, sunColor);
    g.rect(cx - diagonal - 2, cy + diagonal, 3, 3, sunColor);
    g.rect(cx + diagonal, cy + diagonal, 3, 3, sunColor);
  }
  if (!warm) {
    g.rect(x + 40, y + 14, 22, 7, "#fdfdfb"); g.rect(x + 48, y + 10, 18, 6, "#fdfdfb");
    g.rect(x + 84, y + 22, 20, 7, "#fdfdfb"); g.rect(x + 92, y + 18, 14, 5, "#fdfdfb");
  }
  g.rect(x, y + 40, 120, 20, "#a8d8a0");
  g.rect(x + 58, y, 4, 60, "#b98a5e"); g.rect(x, y + 28, 120, 4, "#b98a5e");
}

const BOARD = {x: 330, y: 10, w: 240, h: 70};

function drawBoard(g, x) {
  g.rect(x - 5, BOARD.y - 5, BOARD.w + 10, BOARD.h + 10, "#8a5f3c");
  g.rect(x, BOARD.y, BOARD.w, BOARD.h, "#4e3a30");
  g.rect(x + 8, BOARD.y + BOARD.h - 4, 20, 3, "#f2e4cf");
}

function drawWaterBowl(g, x, y) {
  g.rect(x, y, 24, 8, "#fffaf0"); g.rect(x + 2, y - 2, 20, 4, "#6db5e8");
  g.rect(x + 30, y, 24, 8, "#fffaf0"); g.rect(x + 2, y + 8, 52, 2, "#c9976e");
  g.rect(x + 33, y - 2, 18, 4, "#c47a52");
}

function drawYarn(g, x, y, color) {
  g.rect(x + 2, y, 8, 12, color); g.rect(x, y + 2, 12, 8, color);
  g.rect(x + 2, y + 4, 8, 1, shade(color)); g.rect(x + 4, y + 7, 8, 1, shade(color));
  g.rect(x + 10, y + 10, 14, 2, shade(color));
}

function drawMiniYarn(g, x, y, color) {
  g.rect(x + 1, y, 6, 8, color); g.rect(x, y + 1, 8, 6, color);
  g.rect(x + 2, y + 3, 5, 1, shade(color));
  g.rect(x + 7, y + 5, 6, 2, shade(color));
}

const COFFEE_X = 600, COFFEE_Y = 26;

function drawCoffee(g, x, pct, frame) {
  const y = COFFEE_Y;
  const heat = pct == null ? 0 : pct;
  const busy = heat > 5;
  g.rect(x - 6, y + 32, 88, 6, "#b98a5e");                                 // shelf
  g.rect(x, y, 36, 30, "#b8b4ac"); g.rect(x - 2, y - 3, 40, 5, "#8f8b84");   // body
  g.rect(x + 6, y + 8, 24, 8, "#6a6660");                                  // band
  g.rect(x + 14, y + 18, 8, 6, "#8f8b84");                                 // group head
  g.rect(x + 30, y + 4, 4, 4,
    busy ? (frame % 2 ? "#e05a6a" : "#a04050") : "#5a5650");             // brew light
  g.rect(x + 12, y + 26, 12, 6, "#fff5ea");                                // cup
  if (busy && frame % 2)
    g.rect(x + 18, y + 24, 2, 3, "#6a4a30");                               // pour
  if (heat >= 25) {                                                      // steam
    const wave = frame % 2 ? 2 : 0;
    g.rect(x + 13 + wave, y - 9, 2, 5, "#efe8dc");
    g.rect(x + 22 - wave, y - 11, 2, 6, "#efe8dc");
    if (heat >= 60) g.rect(x + 5 + wave, y - 12, 2, 7, "#efe8dc");
  }
  g.rect(x + 48, y + 22, 10, 10, "#f2a0b8"); g.rect(x + 58, y + 25, 3, 4, "#f2a0b8");
  g.rect(x + 66, y + 22, 10, 10, "#a8d8c0"); g.rect(x + 76, y + 25, 3, 4, "#a8d8c0");
}

function drawPlant(g, x, y) {
  g.rect(x + 6, y + 14, 12, 12, "#c47a52"); g.rect(x + 8, y + 24, 8, 3, "#a05f3e");
  g.rect(x + 4, y + 2, 6, 12, "#2f7d33"); g.rect(x + 12, y, 6, 14, "#3c9440");
  g.rect(x + 9, y + 6, 5, 10, "#2f7d33");
  g.rect(x + 3, y, 4, 4, "#f2a0b8"); g.rect(x + 15, y - 3, 4, 4, "#e05a6a");
}


// ------------------------------------------------------------ trees, laptops, cats

function drawLaptop(g, x, y, accent, mode, pendingCount, flash, frame) {
  if (mode === "closed") {
    g.rect(x, y - 4, 28, 4, "#3a3a38"); g.rect(x, y - 4, 28, 1, "#4c4c4a");
    return;
  }
  g.rect(x, y, 30, 3, "#3a3a38");
  g.rect(x + 3, y - 16, 24, 16, "#2a2a28");
  g.rect(x + 5, y - 14, 20, 12, mode === "lit" ? "#122633" : "#1c1c1b");
  if (mode === "lit") {
    g.rect(x + 3, y - 18, 24, 2, accent);
    for (let i = 0; i < 3; i++)
      g.rect(x + 7, y - 12 + i * 4, 5 + ((frame + i) % 3) * 4, 2, "#5598e7");
  } else if (mode === "spinner") {
    if (flash) {
      g.rect(x + 5, y - 14, 20, 12, "#3f9a55");
      return;
    }
    const centerX = x + 15, centerY = y - 8;
    for (let trail = 0; trail < 4; trail++) {
      const angle = (((frame * 2) - trail) % 8 + 8) % 8 / 8 * Math.PI * 2;
      g.rect(Math.round(centerX + Math.cos(angle) * 5) - 1,
           Math.round(centerY + Math.sin(angle) * 3) - 1, 2, 2,
           trail === 0 ? "#8fd0ff" : "#3d6f9e");
    }
    for (let dot = 0; dot < Math.min(5, pendingCount || 0); dot++)
      g.rect(x + 7 + dot * 4, y - 4, 2, 2, "#f7d64a");
  }
}

function drawTree(g, spot) {
  const platformY = spot.y - spot.post - 14;
  g.rect(spot.x + 6, spot.y, 66, 10, "#a5744a");
  g.rect(spot.x + 6, spot.y, 66, 2, "#bc8a60");
  g.rect(spot.x + 30, platformY + 14, 18, spot.post, "#d9b98c");
  for (let sy = platformY + 18; sy < spot.y - 2; sy += 8)
    g.rect(spot.x + 30, sy, 18, 2, "#c5a577");
  g.rect(spot.x, platformY, 78, 14, "#a5744a");
  g.rect(spot.x + 4, platformY + 2, 70, 6, "#ecd9b0");
}

function drawMan(g, x, frame, carrying) {
  const feetY = H - 16;
  const rows = frame % 2 ? MAN_B : MAN_A;
  drawBitmap(g, rows, x - 21, feetY - rows.length * 3, 3, MAN_COLORS);
  if (carrying) drawBitmap(g, CAT_SLEEP, x - 16, feetY - 74, 2, catColors(carrying));
}

// ------------------------------------------------------------ layout
function spots(count, w) {
  // Cats spread evenly BOTH ways: a diagonal from upper-left to lower-right,
  // so each family owns its own vertical band for bubbles and kittens.
  const result = [];
  if (!count) return result;
  const lowLine = H - 82;
  const stagger = 44;
  for (let i = 0; i < count; i++) {
    // one equal-width band per cat, cat centered in its band
    const centerX = Math.round(w * (i + 0.5) / count);
    const treeY = count <= 2 ? lowLine
      : (i % 2 === 0 ? lowLine - stagger : lowLine);
    result.push({kind: "tree", x: centerX - 39, y: treeY, post: 52});
  }
  return result;
}

function postFor(kittenCount) {
  // One kitten slot per level, so the post grows with the litter — capped so
  // the platform never crowds the wall labels.
  return Math.min(116, 52 + 30 * Math.max(0, kittenCount - 1));
}

function spotGeometry(spot) {
  const platformY = spot.y - spot.post - 14;
  return {catCenterX: spot.x + 39, catBottom: platformY + 10,
          nameX: spot.x + 39, nameY: spot.y + 14,
          laptopX: spot.x + 24, laptopY: platformY + 8};
}

function catAnchors(spot, asleep) {
  const geometry = spotGeometry(spot);
  const catHeight = (asleep ? CAT_SLEEP.length : CAT_SIT_A.length) * 3;
  return {
    x: geometry.catCenterX,
    bubbleY: geometry.catBottom - catHeight - 8,
    nameX: geometry.nameX, nameY: geometry.nameY,
    hover: {x0: geometry.catCenterX - 26, y0: geometry.catBottom - 58,
            x1: geometry.catCenterX + 26, y1: geometry.catBottom + 4},
  };
}

function kittenPlace(spot, index) {
  // One kitten per vertical slot up the tree, alternating sides of the trunk:
  // slot 0 kitten-left, slot 1 kitten-right, … (its bubble takes the other side)
  const geometry = spotGeometry(spot);
  const side = index % 2 === 0 ? -1 : 1;
  return {centerX: geometry.catCenterX + side * 56,
          bottom: spot.y + 6 - index * 30,
          side};
}

function kittenHover(x, y) {
  return {x0: x - 14, y0: y - 24, x1: x + 14, y1: y + 4};
}

function kittenBubble(place) {
  // speech hugs the kitten's inner shoulder, extending across the trunk
  return {x: place.centerX - place.side * 16, y: place.bottom - 10};
}

// The wall props (window, pastry case, board, espresso machine) move together by half the
// extra width on a wide scene, so the group stays centred with its arrangement intact.
const wallShift = (w) => Math.round((w - W) / 2);

function boardText(w) {
  const x = BOARD.x + wallShift(w);
  return {x0: x + 6, y0: BOARD.y + 5, x1: x + BOARD.w - 6, y1: BOARD.y + BOARD.h - 5};
}

// ------------------------------------------------------------ the scene's pieces
function drawBackdrop(g, w, frame, readings) {
  const shift = wallShift(w);
  drawRoom(g, w);
  drawWindow(g, WINDOW_X + shift, readings.cpuLoad, frame);
  drawCase(g, CASE_X + shift, readings.docker, frame);
  drawBoard(g, BOARD.x + shift);
  drawBunting(g, w);
  drawHangingPlant(g, 4);
  drawHangingPlant(g, w - 21);
  drawWaterBowl(g, w - 106, 330);
  drawCoffee(g, COFFEE_X + shift, readings.gpu, frame);
  drawYarn(g, 206, 332, "#e66767");
  drawYarn(g, w - 160, 324, "#9085e9");
  drawPlant(g, 16, 106);
}

// pose: what app.js has decided the cat is doing —
//   status ("working" | "thinking" | "idle"), startled, waiting, raisingHand, blink, turned,
//   sipping, and its laptop (a mode, or null for none), pending (tasks) and flash
function drawCat(g, spot, accent, pose, frame) {
  const geometry = spotGeometry(spot);
  const {status, startled, waiting, raisingHand} = pose;
  let rows;
  if (status === "idle")
    rows = Math.floor(frame / 3) % 2 ? CAT_SLEEP_BREATHE : CAT_SLEEP;
  else if (startled) rows = CAT_STARTLED;
  else if (waiting) rows = CAT_SIT_A;                  // sitting with its coffee
  else if (raisingHand) rows = CAT_SIT_A;              // sitting, paw up (overlay)
  else if (status === "working") rows = frame % 2 ? CAT_SIT_B : CAT_SIT_A;
  else rows = Math.floor(frame / 3) % 2 ? CAT_SIT_B : CAT_SIT_A;
  if (pose.blink)
    rows = rows.map((row, i) =>
      i === 5 ? BLINK_ROW_TOP : i === 6 ? BLINK_ROW_BOTTOM : row);
  if (pose.turned)
    rows = rows.map((row) => [...row].reverse().join(""));
  const shake = startled ? (frame % 2 ? 2 : -2) : 0;
  const bob = status === "working" && !waiting && frame % 2 ? 1 : 0;
  drawBitmap(g, rows, geometry.catCenterX - 24 + shake,
    geometry.catBottom - rows.length * 3 + bob, 3, catColors(accent));
  if (startled) {
    const markX = geometry.catCenterX + 32;
    const markTop = geometry.catBottom - rows.length * 3 - 18;
    g.rect(markX, markTop, 4, 10, "#43302a");
    g.rect(markX, markTop + 13, 4, 4, "#43302a");
  }
  if (waiting) {
    // coffee break: mug held at the side, raised for a sip every so often
    const mugX = geometry.catCenterX + (pose.sipping ? 6 : 16);
    const mugY = geometry.catBottom - (pose.sipping ? 40 : 22);
    g.rect(mugX, mugY, 9, 8, "#fff5ea");
    g.rect(mugX + 9, mugY + 2, 3, 4, "#fff5ea");
    g.rect(mugX + 1, mugY + 1, 7, 2, "#6a4a30");
    if (frame % 2) {
      g.rect(mugX + 2, mugY - 5, 2, 3, "#efe8dc");
      g.rect(mugX + 5, mugY - 8, 2, 3, "#efe8dc");
    }
  }
  if (raisingHand) {
    // one front paw lifted and waving at shoulder height — "over here!"
    const spriteTop = geometry.catBottom - rows.length * 3;
    const up = Math.floor(frame / 2) % 2;
    const pawX = geometry.catCenterX - 32;
    const pawY = spriteTop + (up ? 14 : 22);
    g.rect(pawX + 7, pawY + 4, 9, 6, shade(accent));   // forearm to the body
    g.rect(pawX, pawY, 10, 9, accent);                 // paw
    g.rect(pawX + 2, pawY + 2, 5, 3, "#f0937e");       // toe beans
  }
  if (pose.laptop)
    drawLaptop(g, geometry.laptopX, geometry.laptopY, accent, pose.laptop,
      pose.pending, pose.flash, frame);
}

// A working kitten sits at its place beside the trunk, batting a yarn ball.
function drawKittenWorking(g, place, accent, frame, index, yarnColor) {
  drawBitmap(g, KITTEN, place.centerX - 12,
    place.bottom - KITTEN.length * 3 + (frame % 2 ? 2 : 0), 3, catColors(accent));
  const batted = ((frame + index) % 3) - 1;
  const hop = (frame + index) % 2 ? 2 : 0;
  drawMiniYarn(g, place.centerX - 4 + batted * 5, place.bottom - 4 - hop, yarnColor);
}

// A finished kitten roams the floor after its ball: play = {x, y, ballX, ballY}.
function drawKittenPlaying(g, play, accent, frame, yarnColor) {
  drawMiniYarn(g, play.ballX - 4, play.ballY - 4, yarnColor);
  drawBitmap(g, KITTEN, play.x - 12,
    play.y - KITTEN.length * 3 + (frame % 2 ? 1 : 0), 3, catColors(accent));
}

const art = {
  id: "8bit", px: 1, width: W, height: H,
  // kittens play on the floor below this line
  playTop: 135,
  spots, postFor, catAnchors, kittenPlace, kittenHover, kittenBubble, boardText,
  drawBackdrop, drawTree, drawCat, drawKittenWorking, drawKittenPlaying, drawMan,
};
root.NekomataArt = root.NekomataArt || {};
root.NekomataArt[art.id] = art;
if (typeof module === "object" && module.exports) module.exports = art;
})(typeof globalThis === "object" ? globalThis : this);
