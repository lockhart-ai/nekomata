"use strict";
// Nekomata's art, style "32bit": a cosy handheld-era cat cafe. Outlined, shaded sprites on a
// 2 px grid: the 720x360 scene is 360x180 art pixels. Round soft cats with happy caret
// eyes, a calm panelled room, light from the window on the left.
//
// A style draws the scene and says where things sit; web/app.js decides what happens. The
// interface every style implements is described at the top of 8bit.js.
(function (root) {
const W = 360, H = 180, WALL_H = 62;

// ------------------------------------------------------------ colour helpers
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function hex(c) { return "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""); }
function mix(a, b, t) { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); }

const INK = "#3a2a2e";          // the warm dark used for outlines everywhere

// A cat's whole palette is derived from its session accent.
function catPalette(accent) {
  return {
    O: mix(accent, "#22141c", 0.70),      // outline: a very dark tint of the fur
    S: accent,                            // fur
    D: mix(accent, "#2a1840", 0.30),      // fur in shade
    L: mix(accent, "#fff3d8", 0.42),      // fur in light, paws
    T: mix(accent, "#2a1840", 0.42),      // tabby stripes
    B: mix(accent, "#fff6e6", 0.80),      // muzzle, belly
    C: mix(accent, "#ff8a9c", 0.60),      // cheek blush
    P: "#f79aa6",                         // ears, nose, toe beans
    K: "#2a1a20",                         // eyes
    W: "#ffffff",                         // eye shine
    M: "#fff6e8", m: "#e3d2bc", c: "#7a4f32", // mug, mug shade, coffee
  };
}

// ------------------------------------------------------------ pixel helpers
function sprite(g, rows, x, y, pal, flip) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r], n = row.length;
    for (let c = 0; c < n; c++) {
      const key = row[flip ? n - 1 - c : c];
      if (key === "." || key === " ") continue;
      const color = pal[key];
      if (color) g.rect(x + c, y + r, 1, 1, color);
    }
  }
}
// checkerboard dither of `color` over a rect (phase picks which squares)
function dither(g, x, y, w, h, color, phase) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      if (((x + i + y + j + (phase || 0)) & 1) === 0) g.rect(x + i, y + j, 1, 1, color);
}
function hash(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177 | 0; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }
// a chunky filled disc from row half-widths (still just rects)
const DISCS = {
  3: [1, 2, 3, 3, 2, 1], 4: [2, 3, 4, 4, 4, 4, 3, 2],
  5: [2, 4, 5, 5, 5, 5, 5, 5, 4, 2], 6: [3, 4, 5, 6, 6, 6, 6, 6, 6, 5, 4, 3],
  7: [3, 5, 6, 6, 7, 7, 7, 7, 7, 7, 6, 6, 5, 3],
};
function disc(g, cx, cy, r, color) {
  const rows = DISCS[r];
  for (let i = 0; i < rows.length; i++) g.rect(cx - rows[i], cy - r + i, rows[i] * 2, 1, color);
}

// ------------------------------------------------------------ cats
// Keys: O outline  S fur  D shade  L light  T stripe  B muzzle/belly
//       P pink  C blush  K eye  W shine
const CAT_HEAD = [
"...OO............OO...",
"..OLSO..........OSSO..",
"..OSPSO........OSPDO..",
".OSSPPSOOOOOOOOSPPSDO.",
".OLSSPSSTSTTSTSSPSSDO.",
"OLSSSSSSSSTTSSSSSSSSDO",
"OLSSSSSSSSSSSSSSSSSSDO",
"OSSSSSSSSSSSSSSSSSSSDO",
"OSSSSSSSSSSSSSSSSSSSDO",
"OSSSSSSSSSSSSSSSSSSSDO",
"OSSSSSSSBBPPBBSSSSSSDO",
"OSSCCSSBBOBBOBBSSCCDDO",
".OSSSSSBBBOOBBBSSSSDO.",
".ODSSSSSBBBBBBSSSSDDO.",
"..OODDSSSSSSSSSDDDOO..",
"....OOOOOOOOOOOOOO....",
];
// jolted awake: the same head with the fur standing on end
const CAT_HEAD_SPIKY = [
"....OO...O..O...OO....",
"...OLSO.OSOOSO.OSSO...",
"...OSPSOOSOOSOOSPDO...",
"..OSSPPSOSSSSOSPPSDO..",
"O.OLSPSSTSTTSTSSPSDO.O",
"OOLSSSSSSSTTSSSSSSSDOO",
".OLSSSSSSSSSSSSSSSSDO.",
"OSSSSSSSSSSSSSSSSSSSDO",
".OSSSSSSSSSSSSSSSSSDO.",
"OSSSSSSSSSSSSSSSSSSSDO",
".OSSSSSSBBPPBBSSSSSDO.",
"OSSCCSSBBBBBBBBSSCCDDO",
".OSSSSSBBBBBBBBSSSSDO.",
"O.ODSSSSBBBBBBSSSDDO.O",
"..OODDSSSSSSSSSDDDOO..",
"....OOOOOOOOOOOOOO....",
];
// faces are overlays on the head; `y` is the head row they start at
const FACES = {
  open: {y: 7, rows: [            // smiling carets: a thick ^ per eye
    ".....K..........K.....",
    "....KKK........KKK....",
    "...KK.KK......KK.KK...",
  ]},
  blink: {y: 9, rows: [           // flat line
    "...KKKKK......KKKKK...",
  ]},
  shut: {y: 8, rows: [            // downward curves: a sip, or (one row lower) asleep
    "...K...K......K...K...",
    "....KKK........KKK....",
  ]},
  wide: {y: 6, rows: [            // startled: round and shocked
    "....KKKK......KKKK....",
    "...KWWWWK....KWWWWK...",
    "...KWWKWK....KWKWWK...",
    "...KWWWWK....KWWWWK...",
    "....KKKK......KKKK....",
    "..........KK..........",
    "..........KK..........",
  ]},
};
const CAT_BODY = [
".....OSSSSSSSSO.....",
"....OSSSBBBBSSSO....",
"...OSSSBBBBBBSSDO...",
"..OSSSSBBBBBBSSSDO..",
"..OSSSBBBBBBBBSSDO..",
".OSSSSBBBBBBBBSSSDO.",
".OSSSSBBBBBBBBSSSDO.",
"OSSSSSOBBBBBBOSSSDDO",
"OSSSSSOSBBBBSOSSSDDO",
"OSSSSSOSSOOSSOSSSDDO",
"ODSSSSOSSOOSSOSSDDDO",
"ODDSSOLLLOOLLLOSDDDO",
".OOOOOLLLOOLLLOOOOO.",
"......OOO..OOO......",
];
const CAT_TAIL_A = [
"...OOO....",
"..OTTTO...",
"..OSSSO...",
"..OTTTO...",
"...OSSSO..",
"....OSSSO.",
".....OSSO.",
".....OSSDO",
".....OSSDO",
"....OSSSDO",
"...OSSSDO.",
"..OSSSDDO.",
".OSSSDDO..",
"OOOOOOO...",
];
const CAT_TAIL_B = [
".....OOO..",
"....OTTTO.",
"....OSSSO.",
"....OTTTO.",
"....OSSSO.",
"....OSSSO.",
".....OSSO.",
".....OSSDO",
".....OSSDO",
"....OSSSDO",
"...OSSSDO.",
"..OSSSDDO.",
".OSSSDDO..",
"OOOOOOO...",
];
const CAT_TAIL_PUFF = [
"...O.O.O...",
"..OSOTOSO..",
".OSTTTTTSO.",
"OSSTTTTTSSO",
".OSSSSSSSO.",
"OSSTTTTTSSO",
".OSSSSSSSO.",
"OSSSSSSSSDO",
".OSSSSSSDO.",
"..OSSSSSDO.",
"...OSSSDDO.",
"..OSSSDDO..",
".OSSSDDO...",
"OOOOOOO....",
];
const CAT_PAW = [          // a front paw resting on something
".OO.",
"OLLO",
"OLLO",
".OO.",
];
const CAT_ARM_UP_A = [     // one straight limb, shoulder to paw, held up at 45 degrees
".OOOO.........",
"OLPLPO........",
"OLLPLO........",
"OLLLLSO.......",
".OLLSSSO......",
"..OSSSSSO.....",
"...OSSSSSO....",
"....ODSSSSO...",
".....ODSSSSO..",
"......ODSSSSO.",
".......ODSSSSO",
"........ODSSSS",
".........OOOO.",
];
const CAT_ARM_UP_B = [     // the wave: the same straight arm swung down to a shallow angle
".OOOO...........",
"OPLPLO..........",
"OLPLLSOO........",
"OLLLSSSSOO......",
"OLLSSSSSSSOO....",
".OODSSSSSSSSOO..",
"...OODSSSSSSSSO.",
".....OODSSSSSSSS",
".......OODSSSSSS",
".........OOOOOO.",
];
const MUG = [               // handle on the left
"..OOOOOO.",
".OOcccMmO",
"OMOMMMMmO",
"OMOMMMMmO",
".OOMMMmmO",
"..OMMmmO.",
"...OOOO..",
];
const STEAM_A = ["..s.", ".s..", "..s.", "...."];
const STEAM_B = ["....", ".s..", "..s.", ".s.."];
// asleep: the body is a soft mound behind the head
const CAT_MOUND_A = [
"........OOOOOOO.......",
".....OOOSSSSSSSOO.....",
"...OOSSSSSTSSTSSSOO...",
"..OSSSSSSSTSSTSSSSSO..",
".OSSSSSSSSTSSTSSSSSDO.",
".OSSSSSSSSSSSSSSSSSDO.",
"OSSSSSSSSSSSSSSSSSSDDO",
"OSSSSSSSSSSSSSSSSSSDDO",
"OSSSSSSSSSSSSSSSSSDDDO",
"OSSSSSSSSSSSSSSSSDDDDO",
"OSSSSSSSSSSSSSSSDDDDDO",
"ODSSSSSSSSSSSSDDDDDDDO",
".ODDDDDDDDDDDDDDDDDDO.",
"..OOOOOOOOOOOOOOOOOO..",
];
const CAT_MOUND_B = [       // breathing in: one row taller
"........OOOOOOO.......",
".....OOOSSSSSSSOO.....",
"...OOSSSSSTSSTSSSOO...",
"..OSSSSSSSTSSTSSSSSO..",
".OSSSSSSSSTSSTSSSSSDO.",
".OSSSSSSSSTSSTSSSSSDO.",
".OSSSSSSSSSSSSSSSSSDO.",
"OSSSSSSSSSSSSSSSSSSDDO",
"OSSSSSSSSSSSSSSSSSSDDO",
"OSSSSSSSSSSSSSSSSSDDDO",
"OSSSSSSSSSSSSSSSSDDDDO",
"OSSSSSSSSSSSSSSSDDDDDO",
"ODSSSSSSSSSSSSDDDDDDDO",
".ODDDDDDDDDDDDDDDDDDO.",
"..OOOOOOOOOOOOOOOOOO..",
];
const CAT_TAIL_WRAP = [     // tail curled round to the front
"..OOOOOOOOOOOOO.",
".OTSSTSSSSSSSSDO",
"OTTSSTSSSSSSDDDO",
".OOOOOOOOOOOOOO.",
];

// pose: what app.js has decided the cat is doing (see 8bit.js). `turned` is not drawn: this
// cat is lit from the window side and keeps facing the room.
function drawCat(g, spot, accent, pose, frame) {
  const cx = spot.cx, py = seatY(spot);
  const pal = catPalette(accent);
  const beat = frame % 2;
  const slow = Math.floor(frame / 3) % 2;
  if (pose.status === "idle") {
    // asleep: head down in front of the breathing mound, tail curled round
    const mound = slow ? CAT_MOUND_B : CAT_MOUND_A;
    sprite(g, mound, cx - 5, py - mound.length, pal);
    if (pose.laptop) drawLaptop(g, cx + 12, py, accent, "closed", frame);
    sprite(g, CAT_TAIL_WRAP, cx - 3, py - 4, pal);
    const top = py - 16 + (slow ? 0 : 1);
    sprite(g, CAT_HEAD, cx - 18, top, pal);
    sprite(g, FACES.shut.rows, cx - 18, top + FACES.shut.y + 1, pal);
    return;
  }
  const {startled, waiting, raisingHand} = pose;
  const typing = pose.status === "working" && !startled && !waiting && !raisingHand;
  const x = cx + (startled ? (beat ? 1 : -1) : 0);      // a startled cat shakes
  if (startled) sprite(g, CAT_TAIL_PUFF, x + 6, py - 14, pal);
  else {
    const flick = typing ? slow : Math.floor(frame / 4) % 2;
    sprite(g, flick ? CAT_TAIL_B : CAT_TAIL_A, x + 7, py - 14, pal);
  }
  sprite(g, CAT_BODY, x - 10, py - 14, pal);
  const hy = py - 29 + (typing && beat ? 1 : 0) + (startled ? -1 : 0);
  if (raisingHand) {
    // one straight arm from the shoulder, waved by swinging the whole limb
    if (Math.floor(frame / 2) % 2) sprite(g, CAT_ARM_UP_B, x - 22, py - 21, pal);
    else sprite(g, CAT_ARM_UP_A, x - 20, py - 24, pal);
  }
  sprite(g, startled ? CAT_HEAD_SPIKY : CAT_HEAD, x - 11, hy, pal);
  const sip = waiting && pose.sipping;
  const face = FACES[startled ? "wide" : sip ? "shut" : pose.blink ? "blink" : "open"];
  sprite(g, face.rows, x - 11, hy + face.y, pal);
  if (pose.laptop) drawLaptop(g, cx, py, accent, pose.laptop, frame, pose.pending, pose.flash);
  // paws and the mug, in front of the laptop
  if (typing) {
    sprite(g, CAT_PAW, x - 13, py - 4 - (beat ? 1 : 0), pal);
    sprite(g, CAT_PAW, x + 9, py - 4 - (beat ? 0 : 1), pal);
  } else if (waiting) {
    sprite(g, CAT_PAW, x + 9, py - 4, pal);
    if (sip) {
      sprite(g, MUG, x - 4, hy + 10, pal, true);
      sprite(g, CAT_PAW, x - 7, hy + 13, pal);
      sprite(g, CAT_PAW, x + 2, hy + 14, pal);
    } else {
      sprite(g, MUG, x - 20, py - 11, pal);
      sprite(g, CAT_PAW, x - 13, py - 8, pal);
      sprite(g, beat ? STEAM_B : STEAM_A, x - 17, py - 15, {s: "#fffaf0"});
    }
  } else if (raisingHand) {
    sprite(g, CAT_PAW, x + 9, py - 4, pal);
  } else if (pose.laptop) {
    sprite(g, CAT_PAW, x - 13, py - 4, pal);
    sprite(g, CAT_PAW, x + 9, py - 4, pal);
  }
  if (startled) { g.rect(cx + 14, hy + 1, 2, 6, "#e0503c"); g.rect(cx + 14, hy + 8, 2, 2, "#e0503c"); }
}

// ------------------------------------------------------------ kittens
const KIT_HEAD = [
".OO.......OO.",
"OSPO.....OPSO",
"OSSSOOOOOSSDO",
"OSSSSTSTSSSDO",
"OSSSSSSSSSSDO",
"OSSKSSSSSKSDO",
"OSKSKBPBKSKDO",
"OCSSBBOBBSCDO",
".OSSSBBBSSDO.",
"..OOOOOOOOO..",
];
const KIT_SIT_BODY = [
"..OSSBBBSO...OO",
".OSSSBBBSDO.OSO",
".OSOSBBSODOOSO.",
".OSOLOOLODOSO..",
"..OOOOOOOOOO...",
];
// play bow: rump and tail in the air
const KIT_RUMP_A = [
"..OO......",
".OSSO.....",
".OSO......",
".OSO.OOO..",
".OSSOSSSO.",
"..OSSSSSSO",
"..OSSSSSSO",
"..OSSSSSDO",
"..OSSSSDDO",
"..OSSSSDO.",
"..OSSOOO..",
"..OSSO....",
".OLLLO....",
".OOOOO....",
];
const KIT_RUMP_B = [
"....OO....",
"...OSSO...",
"...OSO....",
"..OSOOOO..",
"..OSSSSSO.",
"..OSSSSSSO",
"..OSSSSSSO",
"..OSSSSSDO",
"..OSSSSDDO",
"..OSSSSDO.",
"..OSSOOO..",
"..OSSO....",
".OLLLO....",
".OOOOO....",
];
const KIT_PAWS = ["OLLO.OLLO", ".OO...OO."];
const KIT_PAW = [".OO.", "OLLO", ".OO."];

// working: sits beside the trunk batting a little yarn ball. `side` is which side of the
// trunk it sits on (-1 left, +1 right); the ball is on its outer side, the tail on the inner.
function drawKittenAt(g, cx, by, accent, frame, side, yarnColor) {
  const pal = catPalette(accent);
  const f = frame % 2, out = side < 0 ? -1 : 1;
  sprite(g, KIT_SIT_BODY, out < 0 ? cx - 5 : cx - 9, by - 5, pal, out > 0);
  sprite(g, KIT_HEAD, cx - 6, by - 14 + (f ? 1 : 0), pal);
  // the ball: nudged out and up on the hit frame
  const bx = out < 0 ? cx - 13 - (f ? 0 : 2) : cx + 8 + (f ? 0 : 2);
  drawMiniYarn(g, bx, by - 6 - (f ? 0 : 2), yarnColor, f);
  // batting paw: wound up by the cheek, then down on the ball
  sprite(g, KIT_PAW, out < 0 ? cx - 9 : cx + 6, f ? by - 9 : by - 6, pal);
}
function drawKittenWorking(g, place, accent, frame, index, yarnColor) {
  drawKittenAt(g, place.centerX, place.bottom, accent, frame + index, place.side, yarnColor);
}
// A finished kitten roams the floor after its ball: play = {x, y, ballX, ballY}. It is drawn
// in a play bow facing the ball, its nose at (x, y), and bats when the ball is in reach.
function drawKittenPlaying(g, play, accent, frame, yarnColor) {
  const pal = catPalette(accent);
  const f = frame % 2;
  const ballX = Math.round(play.ballX), ballY = Math.round(play.ballY);
  const flip = ballX < Math.round(play.x);
  const cx = Math.round(play.x) + (flip ? 6 : -6), by = Math.round(play.y) + 2;
  const reach = Math.hypot(play.ballX - play.x, play.ballY - play.y) < 11;
  drawMiniYarn(g, ballX - 3, ballY - 3, yarnColor, f);
  sprite(g, f ? KIT_RUMP_B : KIT_RUMP_A, flip ? cx + 2 : cx - 12, by - 14, pal, flip);
  const hx = flip ? cx - 9 : cx - 4;
  sprite(g, KIT_HEAD, hx, by - 10 - (f ? 1 : 0), pal);
  if (reach && f) {
    sprite(g, KIT_PAW, flip ? hx - 3 : hx + 12, by - 7, pal);
    sprite(g, KIT_PAW, hx + 2, by - 3, pal);
  } else {
    sprite(g, KIT_PAWS, hx + 2, by - 2, pal);
  }
}

// ------------------------------------------------------------ the adoption man
// O outline  H skin  h shine  N skin shade  R cheek  G glasses  w lens  K eye/mouth
// W shirt  v shirt shade  T tie  t tie shade  Z belt  Y buckle  B trousers  b shade  E shoe  e shoe shine
const MAN_TOP = [
".......OOOOOOOO.......",
".....OOHhhHHHHHOO.....",
"....OHHhhHHHHHHHHO....",
"...OHHhHHHHHHHHHHNO...",
"...OHHHHHHHHHHHHHNO...",
"..OOHHHHHHHHHHHHHNOO..",
".OHOGGGGGGHHGGGGGGOHO.",
".OHOGwwwwGGGGwwwwGOHO.",
".OHOGwKKwGHHGwKKwGOHO.",
"..OOGwwwwGHHGwwwwGOO..",
"...OGGGGGGNNGGGGGGO...",
"...OHRRHHHNNHHHRRNO...",
"...OHHHKHHHHHHKHHNO...",
"....OHHHKKKKKKHHNO....",
".....OOHHHHHHHNOO.....",
".......OOOOOOOO.......",
"......OWWWTTWWWO......",
"....OOWWWWTTWWWWOO....",
"...OWWWWWWTTWWWWWvO...",
"..OWWWWWWWTTWWWWWWvO..",
"..OWWOWWWWTTWWWWOWvO..",
"..OWWOWWWWTTWWWWOWvO..",
"..OWWOWWWWtTWWWWOWvO..",
"..OWWOWWWWWtWWWWOWvO..",
"..OWWOWWWWWWWWWvOWvO..",
"..OHHOWWWWWWWWWvOHHO..",
"..OHHOZZZZYZZZZZOHHO..",
"...OOOBBBBBBBBBbOOO...",
];
const MAN_LEGS_WALK = [
".....OBBBBBBBBBbO.....",
".....OBBBbOOBBBbO.....",
".....OBBBbOOBBBbO.....",
".....OBBBbOOBBBbO.....",
".....OBBBbOOBBBbO.....",
".....OBBBbOOBBBbO.....",
".....OBBBbO.OEEEEO....",
"....OEEEEEO.OEEeEO....",
"...OEeEEEEO..OOOOO....",
"...OOOOOOOO...........",
];
const MAN_PAL = {O: INK, H: "#f2c19c", h: "#fbe0c6", N: "#d99f7c", R: "#f0a08c", G: "#3a3038",
  w: "#dff1f7", K: "#3a2a2e", W: "#fbfaf4", v: "#d5d9de", T: "#d64545", t: "#a83038",
  Z: "#5a3a2a", Y: "#f2c94c", B: "#5d6274", b: "#454a5c", E: "#6b3f2a", e: "#9a6444"};
// carried cat: a sleepy bundle in his arms (cat palette)
const CAT_CARRIED_HEAD = [
".OO.......OO.",
"OSPO.....OPSO",
"OSSSOOOOOSSDO",
"OSSSSTSTSSSDO",
"OSSSSSSSSSSDO",
"OSSSSSSSSSSDO",
"OSKKSBPBKKSDO",
"OCSSBBOBBSCDO",
".OSSSBBBSSDO.",
"..OOOOOOOOO..",
];
const CAT_CARRIED_BODY = [
".OSSSSSSSSDO.",
"OSSSBBBBSSDDO",
"OSSSBBBBSSDDO",
"OSSSSBBSSDDDO",
".OSSSSSSDDDO.",
"..OOOOOOOOO..",
];
const MAN_FOREARM = [".OOOO", "OWHHO", "OvHNO", ".OOOO"];
const CARRIED_TAIL = ["OO.", "OSO", "OSO", ".OSO", ".OTO", "..O"];

// He faces the room whichever way he walks; a cat he carries trails its tail behind him.
function drawMan(g, x, frame, carrying, heading) {
  const cx = Math.round(x), feetY = H - 4;
  const f = frame % 2;
  const left = cx - 11, legsY = feetY - 10, topY = legsY - MAN_TOP.length + (f ? 0 : 1);
  sprite(g, MAN_LEGS_WALK, left, legsY, MAN_PAL, f === 1);
  // when carrying, his arms come forward instead of hanging at his sides
  const top = carrying ? MAN_TOP.map((row, r) => r >= 25 ? "....." + row.slice(5, 17) + "....." : row)
                                .map((row, r) => r >= 25 ? row.slice(0, 5) + "O" + row.slice(6, 16) + "O" + row.slice(17) : row)
                       : MAN_TOP;
  sprite(g, top, left, topY, MAN_PAL);
  if (carrying) {
    const pal = catPalette(carrying);
    const cy = topY + 15;
    sprite(g, CARRIED_TAIL, heading > 0 ? cx - 8 : cx + 4, cy + 13, pal, heading > 0);
    sprite(g, CAT_CARRIED_BODY, cx - 7, cy + 9, pal);
    sprite(g, CAT_CARRIED_HEAD, cx - 7, cy, pal);
    sprite(g, MAN_FOREARM, cx - 9, cy + 10, MAN_PAL);
    sprite(g, MAN_FOREARM, cx + 4, cy + 10, MAN_PAL, true);
  }
}

// ------------------------------------------------------------ laptop
// modes: closed | open | lit | spinner. (cx, py): centre of the base, surface y.
function drawLaptop(g, cx, py, accent, mode, frame, pending, flash) {
  if (mode === "closed") {
    g.rect(cx - 9, py - 3, 18, 3, INK);
    g.rect(cx - 8, py - 3, 16, 2, "#8a8f98");
    g.rect(cx - 8, py - 3, 16, 1, "#b5bac2");
    g.rect(cx - 1, py - 2, 2, 1, mix(accent, "#ffffff", 0.3));
    return;
  }
  const lit = mode === "lit", spin = mode === "spinner";
  g.rect(cx - 8, py - 12, 16, 10, INK);                       // lid
  g.rect(cx - 7, py - 11, 14, 8, "#5a606b");
  g.rect(cx - 7, py - 11, 14, 1, "#737a86");
  g.rect(cx - 6, py - 10, 12, 6, lit ? "#14283a" : spin ? "#1a2030" : "#262a33");
  g.rect(cx - 10, py - 3, 20, 3, INK);                        // deck
  g.rect(cx - 9, py - 3, 18, 2, "#9aa0aa");
  g.rect(cx - 9, py - 3, 18, 1, "#c3c8cf");
  dither(g, cx - 6, py - 2, 12, 1, "#6d737e", 0);
  if (lit) {
    g.rect(cx - 8, py - 13, 16, 1, accent);                   // glow strip on the lid
    const colors = ["#7fd0ff", "#ffd66b", "#9ff0a8", "#ff9db0"];
    for (let i = 0; i < 3; i++) {
      const k = (frame + i) % 4;
      const indent = [0, 2, 2, 1][k], len = [7, 5, 8, 4][k];
      g.rect(cx - 5 + indent, py - 9 + i * 2, Math.min(len, 10 - indent), 1, colors[k]);
    }
  } else if (spin) {
    if (flash) {
      g.rect(cx - 6, py - 10, 12, 6, "#3f9a55");
      const tick = [[-3, -7], [-2, -6], [-1, -5], [0, -6], [1, -7], [2, -8], [3, -9]];
      for (const [dx, dy] of tick) g.rect(cx + dx, py + dy, 1, 1, "#eaffea");
      return;
    }
    const ring = [[-1, -2], [0, -2], [1, -1], [1, 0], [0, 1], [-1, 1], [-2, 0], [-2, -1]];
    for (let i = 0; i < 8; i++) {
      const age = ((frame - i) % 8 + 8) % 8;
      const color = age === 0 ? "#d8f0ff" : age < 3 ? "#5fa8de" : "#2f4660";
      g.rect(cx + ring[i][0] - 2, py - 7 + ring[i][1], 1, 1, color);
    }
    for (let d = 0; d < Math.min(4, pending || 0); d++)
      g.rect(cx + 2, py - 9 + d + (d > 1 ? 0 : 0), 3, 1, d % 2 ? "#1a2030" : "#f7d64a");
    for (let d = 0; d < Math.min(3, pending || 0); d++)
      g.rect(cx + 2, py - 9 + d * 2, 3, 1, "#f7d64a");
  } else {
    g.rect(cx - 5, py - 9, 1, 3, "#3a4050"); g.rect(cx - 4, py - 9, 2, 1, "#3a4050");
  }
}

// ------------------------------------------------------------ small props
const YARN = [
"..OOOO..",
".OahhaO.",
"OahaabaO",
"OabaabaO",
"ObaabaaO",
"OabbaabO",
".OaabbO.",
"..OOOO..",
];
const YARN_MINI_A = [
".OOOO.",
"OahbaO",
"OhabaO",
"OabaaO",
"ObaabO",
".OOOO.",
];
const YARN_MINI_B = [
".OOOO.",
"OabhaO",
"ObahaO",
"OaabaO",
"OabbaO",
".OOOO.",
];
function yarnPal(color) { return {O: mix(color, "#22141c", 0.62), a: color, b: mix(color, "#2a1840", 0.28), h: mix(color, "#ffffff", 0.5)}; }
function drawYarn(g, x, y, color) {
  const pal = yarnPal(color);
  // loose strand
  const s = [[8, 6], [9, 7], [10, 7], [11, 6], [12, 6], [13, 7], [14, 7]];
  for (const [dx, dy] of s) g.rect(x + dx, y + dy, 1, 1, pal.b);
  sprite(g, YARN, x, y, pal);
}
function drawMiniYarn(g, x, y, color, f) {
  const pal = yarnPal(color);
  const s = f ? [[6, 4], [7, 5], [8, 5]] : [[-1, 4], [-2, 5], [-3, 5]];
  for (const [dx, dy] of s) g.rect(x + dx, y + dy, 1, 1, pal.b);
  sprite(g, f ? YARN_MINI_B : YARN_MINI_A, x, y, pal);
}

const BOWL = [
".OOOOOOOOOOO.",
"OrrrrrrrrrrrO",
"OaaaaaaaaaabO",
".OaaaiaaabbO.",
"..OaaaaabbO..",
"...OOOOOOO...",
];
function drawBowls(g, x, y) {
  // a placemat with a water bowl and a food bowl
  g.rect(x - 2, y + 3, 34, 4, "#8a5a66"); g.rect(x - 1, y + 3, 32, 3, "#e9a3ad");
  g.rect(x - 1, y + 3, 32, 1, "#f6c3c8");
  const water = {O: INK, r: "#e8f6ff", a: "#6aa9e0", b: "#4a84c0", i: "#e8f6ff"};
  sprite(g, BOWL, x, y, water);
  g.rect(x + 2, y + 1, 9, 1, "#8fd0f5"); g.rect(x + 3, y + 1, 2, 1, "#ffffff");
  const food = {O: INK, r: "#fff1dc", a: "#f2b05e", b: "#d48a3c", i: "#fff1dc"};
  sprite(g, BOWL, x + 16, y, food);
  g.rect(x + 18, y, 9, 2, "#9a6240"); g.rect(x + 19, y - 1, 7, 1, "#9a6240");
  g.rect(x + 17, y, 1, 1, INK); g.rect(x + 27, y, 1, 1, INK); g.rect(x + 18, y - 1, 1, 1, INK); g.rect(x + 26, y - 1, 1, 1, INK); g.rect(x + 19, y - 2, 7, 1, INK);
}

const PLANT = [
".......OO.........",
"......OgGO...OOO..",
"..OO..OgGO..OgggO.",
".OfFO.OgGO.OgGGO..",
".OFFOOOgGOOgGGO...",
"..OOgGOgGOgGGOOO..",
"...OgGGgGOgGOfFO..",
".OO.OgGGGGGOOFFO..",
"OggOOOGGGGOgGOO...",
"OgGGgOOGGOgGGO....",
".OOGGGOGGOGGO.....",
"...OOGGGGGGO......",
"....OOOOOOOOO.....",
"...OpppppppqqO....",
"...OOOOOOOOOOO....",
"....OpphppqqO.....",
"....OpphppqqO.....",
"....OppppqqqO.....",
".....OpppqqO......",
".....OOOOOOO......",
];
const PLANT_PAL = {O: INK, g: "#6fbf5f", G: "#3e8f4a", f: "#ffc2cf", F: "#f2849a", p: "#d98758", q: "#b5653f", h: "#f0a878"};
function drawPlant(g, x, y) {            // (x, y) = bottom-left of the pot
  g.rect(x + 3, y - 1, 13, 2, "rgba(70,36,24,0.20)");
  sprite(g, PLANT, x, y - PLANT.length, PLANT_PAL);
}

const HANG_POT = [
"OOOOOOOOOOOOO",
"OpppppppppqqO",
"OOOOOOOOOOOOO",
".OphpppppqqO.",
".OphppppqqqO.",
"..OpppppqqO..",
"...OOOOOOO...",
];
function drawHangingPlant(g, x) {  // x = left edge; hangs from the ceiling
  // macrame cords
  for (let i = 0; i < 9; i++) {
    g.rect(x + 6 - Math.min(5, Math.floor(i / 1.5)), 0 + i, 1, 1, "#a8825e");
    g.rect(x + 6 + Math.min(5, Math.floor(i / 1.5)), 0 + i, 1, 1, "#a8825e");
  }
  g.rect(x + 6, 0, 1, 2, "#a8825e");
  // foliage tufts above the rim
  const top = [[1, 7, 3], [3, 6, 3], [6, 5, 3], [8, 6, 3], [10, 7, 2]];
  for (const [dx, dy, w] of top) g.rect(x + dx, dy, w, 3, "#3e8f4a");
  sprite(g, HANG_POT, x, 9, PLANT_PAL);
  // trailing vines
  const vines = [[0, 23], [3, 14], [9, 18], [12, 27]];
  vines.forEach(([dx, len], vi) => {
    let vx = x + dx;
    for (let i = 0; i < len; i++) {
      const vy = 10 + i + (dx > 0 && dx < 12 ? 6 : 0);
      if (i % 5 === 4) vx += (Math.floor(i / 5) + vi) % 2 ? 1 : -1;
      g.rect(vx, vy, 1, 1, "#2f6e3c");
      if (i % 6 === 2) { const side = (Math.floor(i / 6) + vi) % 2 ? 1 : -2; g.rect(vx + side, vy, 2, 2, "#5fae58"); }
    }
    g.rect(vx - 1, 10 + len + (dx > 0 && dx < 12 ? 6 : 0), 2, 2, "#5fae58");
  });
}

function drawBunting(g, w) {
  const colors = ["#f4a9b8", "#a9dcc8", "#f6d878", "#c0b0e6"];
  const yAt = (x) => 2 + [0, 1, 1, 2, 2, 2, 2, 2, 1, 1, 0, 0][Math.floor(((x % 48) + 48) % 48 / 4)];
  for (let x = 0; x < w; x++) g.rect(x, yAt(x), 1, 1, "#9a7458");
  for (let i = 0, x = 8; x < w - 6; x += 16, i++) {
    const c = colors[i % colors.length], y = yAt(x + 3) + 1;
    [7, 5, 5, 3, 1].forEach((rw, r) => g.rect(x + (7 - rw) / 2, y + r, rw, 1, c));   // flat pennant
  }
}

// ------------------------------------------------------------ cat tree
// A spot is {cx, y, post, w}: the tree's centre, the top of its carpeted base, its post
// height, and the width of the scene it stands in.
const seatY = (spot) => spot.y - spot.post - 6;     // the cushion the cat sits on
function drawTree(g, spot, accent, frame, perches) {
  const cx = spot.cx, baseY = spot.y, py = baseY - spot.post - 7;
  const wood = "#b98358", woodL = "#d7a577", woodD = "#8c5c3e", edge = "#5a3a2c";
  // floor shadow
  g.rect(cx - 19, baseY + 5, 38, 2, "rgba(70,36,24,0.22)"); g.rect(cx - 16, baseY + 7, 32, 1, "rgba(70,36,24,0.22)");
  // post: sisal rope, wound in slanted bands
  const top = py + 7;
  g.rect(cx - 5, top, 10, baseY - top, edge);
  g.rect(cx - 4, top, 8, baseY - top, "#dcbf8f");
  g.rect(cx - 4, top, 2, baseY - top, "#eed9ae");
  g.rect(cx + 2, top, 2, baseY - top, "#c4a274");
  for (let y = top; y < baseY; y++)
    for (let i = 0; i < 8; i++)
      if (((y - top) + Math.floor(i / 4)) % 6 === 5) g.rect(cx - 4 + i, y, 1, 1, i < 2 ? "#dcc698" : i > 5 ? "#b3946a" : "#cdb083");
  g.rect(cx - 4, top, 8, 1, "#8c6a4a");                    // shadow under the platform
  // a small carpeted perch for each working kitten above the floor
  for (let i = 1; i < (perches || 0); i++) {
    const k = kittenPlace(spot, i), y = k.bottom;
    const x0 = k.centerX + (k.side < 0 ? -13 : -11);
    g.rect(k.side < 0 ? cx - 16 : cx + 5, y + 1, 11, 3, edge); g.rect(k.side < 0 ? cx - 16 : cx + 5, y + 2, 11, 1, wood);
    g.rect(k.side < 0 ? cx - 8 : cx + 6, y + 4, 2, 2, edge);                       // brace
    g.rect(x0, y - 1, 24, 5, edge); g.rect(x0 + 1, y, 22, 3, "#d9c3a0"); g.rect(x0 + 1, y, 22, 1, "#efe0c2");
  }
  // base: plush carpet
  g.rect(cx - 18, baseY, 36, 6, edge); g.rect(cx - 17, baseY - 1, 34, 1, edge);
  g.rect(cx - 17, baseY, 34, 5, "#d9c3a0"); g.rect(cx - 17, baseY, 34, 1, "#efe0c2");
  g.rect(cx - 17, baseY + 4, 34, 1, "#c7ae88");
  // platform: a wooden shelf with a cushion in the cat's colour
  g.rect(cx - 21, py + 2, 42, 5, edge);
  g.rect(cx - 20, py + 3, 40, 3, wood); g.rect(cx - 20, py + 3, 40, 1, woodL); g.rect(cx - 20, py + 5, 40, 1, woodD);
  const cush = mix(accent, "#fff3dc", 0.62), cushD = mix(accent, "#b89a80", 0.55), cushL = mix(cush, "#ffffff", 0.5);
  g.rect(cx - 19, py - 1, 38, 4, edge); g.rect(cx - 20, py, 40, 2, edge);
  g.rect(cx - 19, py, 38, 2, cush); g.rect(cx - 18, py - 0, 36, 1, cushL); g.rect(cx - 19, py + 2, 38, 1, cushD);
}

// ------------------------------------------------------------ room
function drawRoom(g, w) {
  // wallpaper: cream with very soft broad stripes
  g.rect(0, 0, w, WALL_H, "#f8e8cb");
  for (let x = 6; x < w; x += 24) g.rect(x, 0, 12, 49, "#f6e3c3");
  // picture rail at the ceiling
  g.rect(0, 0, w, 2, "#a9714c"); g.rect(0, 0, w, 1, "#c98f62");
  // wainscot: a rail and wide, shallow panels
  const top = 48;
  g.rect(0, top, w, 3, "#c98f62"); g.rect(0, top, w, 1, "#e7b98c"); g.rect(0, top + 2, w, 1, "#9a6846");
  g.rect(0, top + 3, w, WALL_H - top - 3, "#d6a377");
  for (let x = -6; x < w; x += 40) {
    g.rect(x + 3, top + 5, 34, 5, "#cb9565");                 // recessed panel
    g.rect(x + 3, top + 5, 34, 1, "#ad7a4e");
  }
  g.rect(0, WALL_H - 3, w, 3, "#a8744c"); g.rect(0, WALL_H - 1, w, 1, "#6e4630");
  // floor: long staggered planks in two close tones, a little grain
  const tones = ["#cd9d75", "#c9976f", "#d1a27a"];
  const PH = 10;
  for (let y = WALL_H, row = 0; y < H; y += PH, row++) {
    const offset = (row * 37) % 96;
    for (let x = -offset, n = 0; x < w; x += 96, n++) {
      const tone = tones[Math.floor(hash(row, n) * tones.length)];
      g.rect(x, y, 96, PH, tone);
      g.rect(x, y, 1, PH, "#bb8a66");
      if (hash(row + 5, n + 2) > 0.45) {
        const gx = x + 8 + Math.floor(hash(row * 7, n) * 70), gy = y + 3 + Math.floor(hash(row, n * 5) * 4);
        g.rect(gx, gy, 6 + Math.floor(hash(n, row) * 6), 1, mix(tone, "#8a5a3c", 0.12));
      }
    }
    g.rect(0, y + PH - 1, w, 1, "#bb8a66");
  }
  // the wall's shadow on the floor
  g.rect(0, WALL_H, w, 2, "rgba(90,50,30,0.18)");
}

// rug: a soft oval-ish mat with a border
function drawRug(g, x, y, w, h) {
  const a = "#cf7a78", b = "#e9c2a8", c = "#8a3f4c";
  g.rect(x + 2, y, w - 4, h, c); g.rect(x, y + 2, w, h - 4, c); g.rect(x + 1, y + 1, w - 2, h - 2, c);
  g.rect(x + 2, y + 1, w - 4, h - 2, a); g.rect(x + 1, y + 2, w - 2, h - 4, a);
  // one soft inner border
  g.rect(x + 5, y + 3, w - 10, 1, b); g.rect(x + 5, y + h - 4, w - 10, 1, b);
  g.rect(x + 4, y + 4, 1, h - 8, b); g.rect(x + w - 5, y + 4, 1, h - 8, b);
}

// ------------------------------------------------------------ window (CPU)
const CLOUD = [
"....www.....",
"..wwwwwww...",
".wwwwwwwwww.",
"wwwwwwwwwwww",
".ssssssssss.",
];
const CLOUD_SMALL = [
"..www...",
".wwwwww.",
"wwwwwwww",
".ssssss.",
];
// state: 0 cool, 1 warm, 2 hot. (x, y): top-left of the frame.
const WIN_W = 62, WIN_H = 34;
function windowState(load) { return load >= 70 ? 2 : load >= 35 ? 1 : 0; }
function drawWindow(g, x, y, state, frame) {
  const f = (frame || 0) % 2;
  const wood = "#b47a50", woodL = "#dba673", woodD = "#8a5a3c", edge = "#5a3a2c";
  const gx = x + 3, gy = y + 3, gw = 56, gh = 26;
  g.rect(x, y, WIN_W, 32, edge);
  g.rect(x + 1, y + 1, WIN_W - 2, 30, wood); g.rect(x + 1, y + 1, WIN_W - 2, 1, woodL); g.rect(x + 1, y + 1, 1, 30, woodL);
  g.rect(gx - 1, gy - 1, gw + 2, gh + 2, woodD);
  // sky
  const sky = [["#bfe3f4", "#d3edf8", "#e6f5fb"], ["#8fd0f2", "#b3e0f6", "#fdf0c4"], ["#f9b877", "#fbcf8e", "#fde5ae"]][state];
  g.rect(gx, gy, gw, gh, sky[0]);
  g.rect(gx, gy + 10, gw, gh - 10, sky[1]);
  g.rect(gx, gy + 16, gw, gh - 16, sky[2]);
  // sun
  const sx = gx + 13, sy = gy + 14;
  if (state === 0) {
    disc(g, sx, sy, 4, "#fbf3c8"); disc(g, sx, sy, 3, "#fff9de");
    sprite(g, CLOUD, gx + 9, gy + 14, {w: "#ffffff", s: "#d2e3ee"});
    sprite(g, CLOUD, gx + 40, gy + 12, {w: "#ffffff", s: "#d2e3ee"});
  } else if (state === 1) {
    const ray = "#fbd75a";
    for (const [dx, dy, w, h] of [[-9, 0, 2, 1], [8, 0, 2, 1], [0, -9, 1, 2], [0, 8, 1, 2]])
      g.rect(sx + dx - (w > 1 ? 0 : 0), sy + dy, w, h, ray);
    disc(g, sx, sy, 5, "#f9c93a"); disc(g, sx, sy, 4, "#fde27a");
    sprite(g, CLOUD_SMALL, gx + 38, gy + 7, {w: "#ffffff", s: "#cfe6f3"});
  } else {
    const ray = "#ff8a2e", L = f ? 4 : 3;
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      g.rect(sx + (ux > 0 ? 9 : ux < 0 ? -9 - L : -1), sy + (uy > 0 ? 9 : uy < 0 ? -9 - L : -1), ux ? L + 1 : 2, uy > 0 ? 3 : uy ? L + 1 : 2, ray);
    disc(g, sx, sy, 7, "#ff9a2e"); disc(g, sx, sy, 6, "#ffc23a"); disc(g, sx, sy, 4, "#ffe072");
  }
  // hills and a little hedge
  const far = ["#a9d6b4", "#9fd39a", "#d8c877"][state], near = ["#7fc08a", "#6fbf5f", "#a9b552"][state], nearD = ["#5fa672", "#4f9f4a", "#8a9a3e"][state];
  const farH = [2, 3, 4, 5, 5, 6, 6, 6, 5, 5, 4, 3, 3, 2, 2, 2, 3, 4, 5, 6, 7, 7, 7, 6, 6, 5, 4, 3];
  for (let i = 0; i < gw; i++) { const hh = farH[Math.floor(i / 2) % farH.length]; g.rect(gx + i, gy + gh - 4 - hh, 1, hh + 4, far); }
  const nearH = [3, 3, 4, 4, 5, 5, 5, 4, 4, 3, 3, 2, 2, 2, 2, 3, 3, 4, 4, 4, 3, 3, 2, 2, 2, 3, 4, 5];
  for (let i = 0; i < gw; i++) { const hh = nearH[Math.floor((i + 9) / 2) % nearH.length]; g.rect(gx + i, gy + gh - hh, 1, hh, near); }
  // glass shine
  for (let i = 0; i < 6; i++) g.rect(gx + 50 - i, gy + 5 + i, 2, 1, "rgba(255,255,255,0.35)");
  // mullions
  g.rect(gx + 27, gy, 2, gh, wood); g.rect(gx + 27, gy, 1, gh, woodL);
  g.rect(gx, gy, gw, 1, "rgba(60,30,20,0.25)"); g.rect(gx, gy, 1, gh, "rgba(60,30,20,0.25)");
  // valance on a rod
  g.rect(x - 2, y - 1, WIN_W + 4, 1, edge); g.rect(x - 3, y - 2, 2, 3, edge); g.rect(x + WIN_W + 1, y - 2, 2, 3, edge);
  for (let i = 0; i < WIN_W; i++) {
    const scallop = [4, 5, 5, 5, 4, 3][i % 6];
    for (let j = 0; j < scallop; j++) {
      g.rect(x + i, y + j, 1, 1, j === 0 ? "#f0a8a2" : j >= scallop - 1 ? "#fff3e6" : "#e58a84");   // plain valance, pale trim
    }
    g.rect(x + i, y + scallop, 1, 1, "rgba(60,30,20,0.30)");
  }
  // sill
  g.rect(x - 2, y + 31, WIN_W + 4, 3, edge); g.rect(x - 1, y + 31, WIN_W + 2, 2, woodL); g.rect(x - 1, y + 32, WIN_W + 2, 1, wood);
}
// sunlight falling through the window onto the floor
function drawSunbeam(g, x, state) {
  const color = ["rgba(235,245,255,0.08)", "rgba(255,240,180,0.16)", "rgba(255,210,130,0.22)"][state];
  const y0 = WALL_H + 5, rows = 44;
  for (let i = 0; i < rows; i++) g.rect(x + 12 + Math.floor(i * 0.75), y0 + i, 64, 1, color);
}

// ------------------------------------------------------------ pastry case (docker)
// a: main  b: shade  w: cream  c: cream shade  r: red  y: sponge  k: dark  h: shine
const PASTRIES = [
  { // strawberry shortcake
    rows: [
".....OO.....",
"....OrhO....",
"..OOOrrOOO..",
".OwwwwwwwwO.",
"OwwwwwwwwwwO",
"OaaaaaaaaaaO",
"OyyyyyyyyyyO",
".OOOOOOOOOO.",
    ], pal: {a: "#f49ab0", b: "#d9708c", w: "#fffaf2", r: "#e0434f", h: "#ff9aa0", y: "#f6d79a"}},
  { // matcha cupcake
    rows: [
"....OOOO....",
"...OaaaaO...",
"..OaaaaabO..",
".OaaaaaabbO.",
".OOOOOOOOOO.",
"..OyyyyyqO..",
"..OyyyyyqO..",
"...OOOOOO...",
    ], pal: {a: "#9fd68a", b: "#6fae62", w: "#dff2c8", y: "#fff1dc", q: "#e9c9a0"}},
  { // lemon tart slice
    rows: [
"............",
"........OOO.",
".....OOOwwO.",
"..OOOaaawaO.",
"OOaahaaaaaO.",
"OaaaaaaaabO.",
"OyyyyyyyyyO.",
".OOOOOOOOO..",
    ], pal: {a: "#f7d64a", b: "#e0b030", h: "#fff3a8", w: "#fffaf2", y: "#d9a05e"}},
  { // blueberry layer slice
    rows: [
"....OOOO....",
"...OkkkkO...",
".OOOOOOOOOO.",
".OaaaaaaaaO.",
".OwwwwwwwwO.",
".OaaaaaaabO.",
".OyyyyyyyyO.",
".OOOOOOOOOO.",
    ], pal: {a: "#c3b2e8", b: "#a08ad0", w: "#fffaf2", k: "#5a4a9a", h: "#9a8ae0", y: "#f6d79a"}},
  { // glazed doughnut
    rows: [
"...OOOOOO...",
".OOaaaaaaOO.",
"OaaaOOOOaaaO",
"OaaaOkkOaaaO",
"OaaaaaaaaaaO",
"OyyaaaaaayyO",
".OyyyyyyyyO.",
"..OOOOOOOO..",
    ], pal: {a: "#f2a66a", b: "#d98448", w: "#fffaf2", r: "#e0434f", y: "#e3b77a", k: "#8a5a3c"}},
  { // blue jelly with cream
    rows: [
".....OO.....",
"....OrrO....",
"...OwwwwO...",
"..OahaaaaO..",
".OahaaaaabO.",
".OaaaaaabbO.",
"OwwwwwwwwwwO",
".OOOOOOOOOO.",
    ], pal: {a: "#8fd0f2", b: "#5fa8dc", h: "#dff4ff", w: "#fffaf2", r: "#e0434f"}},
];
function drawPastry(g, x, y, index, busy, frame) {  // (x, y): top-left of the 12x8 pastry
  const p = PASTRIES[index % PASTRIES.length];
  sprite(g, p.rows, x, y, Object.assign({O: INK}, p.pal));
  if (busy) {
    const f = (frame || 0) % 2;
    const cx = x + (index % PASTRIES.length === 2 ? 3 : 8);
    const top = y + (index % PASTRIES.length === 2 ? 1 : -1);
    g.rect(cx, top - 1, 1, 3, "#fffaf2"); g.rect(cx, top, 1, 1, "#f49ab0");
    g.rect(cx, top - 3, 1, 2, "#ff8a2e"); g.rect(cx, top - 3 - (f ? 1 : 0), 1, 1, "#ffd23e"); g.rect(cx + (f ? 1 : -1), top - 2, 1, 1, "#ffb84a");
  }
}
const CASE_W = 64, CASE_H = 36;
// containers: array of {busy} (up to six)
function drawCase(g, x, y, containers, frame) {
  const wood = "#b47a50", woodL = "#dba673", woodD = "#8a5a3c", edge = "#5a3a2c";
  // top
  g.rect(x + 1, y, CASE_W - 2, 4, edge); g.rect(x, y + 1, CASE_W, 3, edge);
  g.rect(x + 1, y + 1, CASE_W - 2, 2, wood); g.rect(x + 2, y + 1, CASE_W - 4, 1, woodL);
  // glass body
  g.rect(x + 1, y + 4, CASE_W - 2, 27, edge);
  g.rect(x + 2, y + 4, CASE_W - 4, 26, "#fdf3e2");
  g.rect(x + 2, y + 4, CASE_W - 4, 3, "#f6e8d0");
  g.rect(x + 2, y + 18, CASE_W - 4, 3, "#f6e8d0");
  // shelves
  for (const sy of [y + 16, y + 29]) { g.rect(x + 2, sy, CASE_W - 4, 1, "#bfe0e6"); g.rect(x + 2, sy + 1, CASE_W - 4, 1, "#8fb7c2"); }
  (containers || []).slice(0, 6).forEach((c, i) => {
    if (!c) return;
    const px = x + 6 + (i % 3) * 19, py = y + (i < 3 ? 8 : 21);
    drawPastry(g, px, py, i, c.busy, frame + i);
  });
  // glass reflections and corner posts
  for (let i = 0; i < 6; i++) g.rect(x + 56 - i, y + 7 + i, 2, 1, "rgba(255,255,255,0.40)");
  g.rect(x + 2, y + 4, 1, 26, "#cfe6ea"); g.rect(x + CASE_W - 3, y + 4, 1, 26, "#a9c9d2");
  // base with a little sign
  g.rect(x, y + 30, CASE_W, 6, edge);
  g.rect(x + 1, y + 31, CASE_W - 2, 4, wood); g.rect(x + 1, y + 31, CASE_W - 2, 1, woodL); g.rect(x + 1, y + 34, CASE_W - 2, 1, woodD);
  g.rect(x + 25, y + 32, 14, 2, "#f3dfc0");                // plain label plate
}

// ------------------------------------------------------------ chalkboard
const BOARD_W = 126, BOARD_H = 35;
// The slate is left clean: its text is DOM, laid over it by app.js.
function drawBoard(g, x, y) {
  const wood = "#a9714c", woodL = "#d29c6e", woodD = "#7a4e36", edge = "#5a3a2c";
  g.rect(x, y, BOARD_W, BOARD_H, edge);
  g.rect(x + 1, y + 1, BOARD_W - 2, BOARD_H - 2, wood); g.rect(x + 1, y + 1, BOARD_W - 2, 1, woodL); g.rect(x + 1, y + 1, 1, BOARD_H - 2, woodL);
  g.rect(x + 1, y + BOARD_H - 2, BOARD_W - 2, 1, woodD);
  g.rect(x + 3, y + 3, BOARD_W - 6, BOARD_H - 6, edge);
  const sx = x + 4, sy = y + 4, sw = BOARD_W - 8, sh = BOARD_H - 8;
  g.rect(sx, sy, sw, sh, "#33443d");
  dither(g, sx + 70, sy + 16, 22, 2, "#384a42", 0);            // one faint wipe mark
  g.rect(sx, sy, sw, 1, "#27352f"); g.rect(sx, sy, 1, sh, "#27352f");
  // ledge with chalk and eraser
  g.rect(x + 6, y + BOARD_H - 1, BOARD_W - 12, 3, edge); g.rect(x + 7, y + BOARD_H - 1, BOARD_W - 14, 2, woodL); g.rect(x + 7, y + BOARD_H, BOARD_W - 14, 1, wood);
  g.rect(x + 12, y + BOARD_H - 2, 4, 1, "#fffaf2");
  g.rect(x + BOARD_W - 22, y + BOARD_H - 3, 8, 2, edge); g.rect(x + BOARD_W - 21, y + BOARD_H - 3, 6, 1, "#e9a3ad");
}

// ------------------------------------------------------------ espresso machine (GPU)
const PUFF = [".ss.", "ssss", "ssss", ".dd."];
const PUFF_BIG = ["..sss..", ".sssss.", "sssssss", "sssssss", ".sdddd.", "..dd..."];
const PUFF_SMALL = [".s.", "sss", ".s."];
// state: 0 idle, 1 brewing, 2 steaming. (x, y): top-left of the machine; the shelf is drawn too.
function espressoState(pct) { return pct == null || pct <= 5 ? 0 : pct < 60 ? 1 : 2; }
function drawEspresso(g, x, y, state, frame) {
  const f = (frame || 0) % 2, f4 = (frame || 0) % 4;
  const edge = "#4a3038", red = "#d9564c", redL = "#f0877a", redD = "#a93c40";
  const chrome = "#c9d2d6", chromeL = "#eef3f4", chromeD = "#8d9aa1";
  const shelfY = y + 27;
  // shelf with brackets
  g.rect(x - 6, shelfY, 58, 4, "#5a3a2c"); g.rect(x - 5, shelfY, 56, 3, "#b47a50"); g.rect(x - 5, shelfY, 56, 1, "#dba673"); g.rect(x - 5, shelfY + 2, 56, 1, "#8a5a3c");
  for (const bx of [x - 2, x + 44]) { g.rect(bx, shelfY + 4, 3, 4, "#5a3a2c"); g.rect(bx + 1, shelfY + 4, 1, 3, "#8a5a3c"); g.rect(bx + (bx < x ? 3 : -1), shelfY + 4, 1, 2, "#5a3a2c"); }
  // cup rail and warming cups
  g.rect(x + 3, y + 1, 22, 1, edge); g.rect(x + 3, y, 1, 2, edge); g.rect(x + 24, y, 1, 2, edge);
  for (const cx of [x + 6, x + 14]) { g.rect(cx, y - 3, 6, 4, edge); g.rect(cx + 1, y - 3, 4, 3, "#fffaf2"); g.rect(cx + 1, y - 1, 4, 1, "#e3d2bc"); g.rect(cx + 6, y - 2, 1, 2, edge); }
  // top cap
  g.rect(x, y + 2, 28, 4, edge); g.rect(x + 1, y + 2, 26, 3, chrome); g.rect(x + 1, y + 2, 26, 1, chromeL); g.rect(x + 1, y + 4, 26, 1, chromeD);
  // body
  g.rect(x + 1, y + 6, 26, 21, edge);
  g.rect(x + 2, y + 6, 24, 13, red); g.rect(x + 2, y + 6, 2, 13, redL); g.rect(x + 22, y + 6, 4, 13, redD); g.rect(x + 2, y + 6, 24, 1, redL);
  // control panel
  g.rect(x + 5, y + 8, 18, 7, edge); g.rect(x + 6, y + 9, 16, 5, chrome); g.rect(x + 6, y + 9, 16, 1, chromeL);
  // pressure gauge
  g.rect(x + 7, y + 9, 5, 5, "#fffaf2");
  g.rect(x + 11, y + 10, 1, 2, "#e0434f");                                    // red zone
  const needle = state === 0 ? [[8, 12], [7, 12]] : state === 1 ? [[9, 10], [9, 9]] : [[10, 10], [11, 10]];
  for (const [nx, ny] of needle) g.rect(x + nx, y + ny, 1, 1, edge);
  g.rect(x + 9, y + 11, 1, 1, edge);
  // buttons / lamps
  g.rect(x + 14, y + 10, 3, 3, edge); g.rect(x + 18, y + 10, 3, 3, edge);
  g.rect(x + 15, y + 11, 1, 1, state === 0 ? "#6a7278" : f ? "#ffd23e" : "#ff8a2e");
  g.rect(x + 19, y + 11, 1, 1, state === 2 ? (f ? "#ff5a5a" : "#b83a44") : state === 1 ? "#7fe08a" : "#6a7278");
  // bay
  g.rect(x + 2, y + 19, 24, 6, "#3a2c34"); g.rect(x + 2, y + 19, 3, 6, red); g.rect(x + 2, y + 19, 1, 6, redL); g.rect(x + 23, y + 19, 3, 6, redD);
  // group head and portafilter
  g.rect(x + 10, y + 16, 8, 4, edge); g.rect(x + 11, y + 16, 6, 3, chrome); g.rect(x + 11, y + 16, 6, 1, chromeL);
  g.rect(x + 9, y + 19, 10, 2, edge); g.rect(x + 10, y + 19, 8, 1, chromeD);
  g.rect(x + 18, y + 19, 7, 2, edge); g.rect(x + 19, y + 19, 5, 1, "#6b4a3a");
  // cup on the drip tray
  g.rect(x + 10, y + 22, 8, 3, edge); g.rect(x + 11, y + 22, 6, 2, "#fffaf2"); g.rect(x + 18, y + 22, 1, 2, edge);
  if (state > 0) {
    g.rect(x + 11, y + 22, 6, 1, "#7a4f32");
    if (f) { g.rect(x + 13, y + 21, 1, 1, "#7a4f32"); g.rect(x + 14, y + 21, 1, 1, "#a8703f"); } else g.rect(x + 14, y + 21, 1, 1, "#7a4f32");
  }
  // drip tray
  g.rect(x, y + 24, 28, 3, edge); g.rect(x + 1, y + 25, 26, 1, chromeD);
  // steam wand on the left
  g.rect(x - 2, y + 9, 3, 2, edge); g.rect(x - 3, y + 9, 2, 13, edge); g.rect(x - 2, y + 10, 1, 11, chrome); g.rect(x - 3, y + 21, 2, 2, edge);
  // little milk jug under the wand
  g.rect(x - 6, y + 22, 5, 5, edge); g.rect(x - 5, y + 23, 3, 3, chrome); g.rect(x - 5, y + 23, 1, 3, chromeL);
  // steam
  const sp = {s: "#ffffff", d: "#d3e0e6"};
  if (state === 1) {
    sprite(g, f ? STEAM_B : STEAM_A, x + 12, y + 12 - 16 - 3, sp);
  }
  if (state === 2) {
    const rise = f4;
    // a jet from the wand, billowing up the left side
    sprite(g, PUFF_BIG, x - 11 + (f ? 1 : 0), y + 9 - rise * 2, sp);
    sprite(g, PUFF, x - 8 - (f ? 1 : 0), y + 2 - rise * 2, sp);
    // and the boiler venting above the cups
    sprite(g, PUFF, x + 20 + (f ? 1 : 0), y - 7 - rise, sp);
  }
  // two mugs on the shelf
  drawMugSide(g, x + 32, shelfY - 6, "#f4a9b8"); drawMugSide(g, x + 42, shelfY - 6, "#a9dcc8");
}
function drawMugSide(g, x, y, color) {
  g.rect(x, y, 7, 6, INK); g.rect(x + 1, y + 1, 5, 4, color); g.rect(x + 1, y + 1, 1, 4, mix(color, "#ffffff", 0.5)); g.rect(x + 5, y + 1, 1, 4, mix(color, "#5a2a40", 0.25));
  g.rect(x + 7, y + 1, 2, 4, INK); g.rect(x + 7, y + 2, 1, 2, color);
}

// ------------------------------------------------------------ layout
function spots(count, w) {
  // One equal band of floor per cat, the trees staggered on two lines so each family has
  // its own room for bubbles and kittens.
  const result = [];
  for (let i = 0; i < count; i++) {
    const cx = Math.round(w * (i + 0.5) / count);
    const y = count <= 2 ? 139 : (i % 2 === 0 ? 117 : 139);
    result.push({kind: "tree", cx, y, post: 26, w});
  }
  return result;
}

function postFor(kittenCount) {
  // One level per working kitten, so the post grows with the litter; capped so the platform
  // stays off the wall props.
  return Math.min(58, Math.max(26, 15 * (kittenCount - 1) + 16));
}

function catAnchors(spot, asleep) {
  const seat = seatY(spot);
  return {
    x: spot.cx,
    bubbleY: seat - (asleep ? 17 : 29) - 3,
    nameX: spot.cx, nameY: spot.y + 8,
    hover: {x0: spot.cx - 13, y0: seat - 29, x1: spot.cx + 13, y1: seat + 2},
  };
}

// Working kittens sit on alternating sides of the trunk, one per level: slot 0 on the floor
// to the left, slot 1 on a perch to the right, and so on up.
// A tree at the edge of the room keeps its kittens (and their yarn) inside the scene.
function kittenPlace(spot, index) {
  const side = index % 2 === 0 ? -1 : 1;
  const centerX = Math.max(16, Math.min(spot.w - 16, spot.cx + side * 27));
  return {centerX, bottom: spot.y + 5 - index * 15, side};
}

function kittenHover(x, y) {
  return {x0: x - 8, y0: y - 15, x1: x + 8, y1: y + 2};
}

function kittenBubble(place) {
  // speech starts at the kitten's inner shoulder and runs across the trunk
  return {x: place.centerX - place.side * 9, y: place.bottom - 6};
}

// The wall props move together by half the extra width on a wide scene, so the group stays
// centred with its arrangement intact.
const WINDOW_X = 16, WINDOW_Y = 13, CASE_X = 88, CASE_Y = 12, BOARD_X = 162, BOARD_Y = 11;
const ESPRESSO_X = 305, ESPRESSO_Y = 17;
const wallShift = (w) => Math.round((w - W) / 2);

function boardText(w) {
  const x = BOARD_X + wallShift(w);
  return {x0: x + 6, y0: BOARD_Y + 5, x1: x + BOARD_W - 6, y1: BOARD_Y + BOARD_H - 5};
}

// ------------------------------------------------------------ the scene's pieces
function drawBackdrop(g, w, frame, readings) {
  const shift = wallShift(w);
  const sun = windowState(readings.cpuLoad);
  drawRoom(g, w);
  drawWindow(g, WINDOW_X + shift, WINDOW_Y, sun, frame);
  // a cake per container; a busy one has a lit candle
  drawCase(g, CASE_X + shift, CASE_Y,
    readings.docker.map((container) => ({busy: container.cpu >= 20})), frame);
  drawBoard(g, BOARD_X + shift, BOARD_Y);
  drawEspresso(g, ESPRESSO_X + shift, ESPRESSO_Y, espressoState(readings.gpu), frame);
  drawBunting(g, w);
  drawHangingPlant(g, 1);
  drawHangingPlant(g, w - 14);
  drawSunbeam(g, WINDOW_X + shift, sun);
  drawRug(g, Math.floor(w / 2) - 46, 161, 92, 16);
  drawPlant(g, 4, WALL_H + 12);
  drawBowls(g, w - 44, 170);
  drawYarn(g, 118, 168, "#e66767");
  drawYarn(g, w - 104, 160, "#9085e9");
}

const art = {
  id: "32bit", px: 2, width: W, height: H,
  // kittens play on the open floor in front of the trees, below this line
  playTop: 150,
  spots, postFor, catAnchors, kittenPlace, kittenHover, kittenBubble, boardText,
  drawBackdrop, drawTree, drawCat, drawKittenWorking, drawKittenPlaying, drawMan,
};
root.NekomataArt = root.NekomataArt || {};
root.NekomataArt[art.id] = art;
if (typeof module === "object" && module.exports) module.exports = art;
})(typeof globalThis === "object" ? globalThis : this);
