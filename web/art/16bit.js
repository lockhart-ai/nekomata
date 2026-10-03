"use strict";
// Nekomata's art, style "16bit": the midway cafe. Chunky cats on a 2.5 px grid (the 720x360
// scene is 288x144 art pixels), three tones per material and no outlines: shade sits only on
// under-edges. The cats keep the 8bit cat's square skull, stair-step ears, happy caret eyes
// and upright tail, with a pale muzzle, a small smile and a shaded chin line.
//
// It implements the style interface described at the top of web/art/8bit.js. A spot is
// {cx, baseY, post}: a tree's centre column, the top of its base slab and its post height.
(function (root) {
const W = 288, H = 144, WALL_H = 46;
const PX = 2.5;                 // scene pixels per art pixel

// ------------------------------------------------------------ colour helpers
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function hex(c) { return "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""); }
function mix(a, b, t) { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); }

// Shared room materials: each is a base tone, one light and one shade. No ink outline.
const WOOD = "#b78457", WOOD_L = "#d6a877", WOOD_D = "#8a5e3d";
const CREAM = "#fff6e6";

// A cat's palette: three tones from its accent, plus fixed pink and eye colours.
function catPalette(accent) {
  return {
    S: accent,                            // fur
    D: mix(accent, "#2a1840", 0.34),      // shade: under-edges, stripes, the lines between limbs
    B: mix(accent, "#fff6e6", 0.74),      // pale muzzle, belly and paws
    P: "#f4978a",                         // inner ears, nose, toe beans
    M: "#7a4652",                         // mouth: a soft dark, lighter than the eyes, that reads on every pale muzzle
    K: "#241a1e",                         // eyes
    W: "#ffffff",                         // eye shine, startled eye whites
    U: "#fff6e8", u: "#dcc8ae", c: "#6f4a30", r: "#e0705f", // mug, mug shade, coffee
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
function hash(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177 | 0; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }
// a chunky "round" block: a square with its corners knocked off (1 step, or 2 when cut = 2)
function blob(g, x, y, w, h, color, cut) {
  if (cut === 2) {
    g.rect(x + 2, y, w - 4, h, color); g.rect(x + 1, y + 1, w - 2, h - 2, color); g.rect(x, y + 2, w, h - 4, color);
  } else {
    g.rect(x + 1, y, w - 2, h, color); g.rect(x, y + 1, w, h - 2, color);
  }
}

// ============================================================ CATS
// Keys: S fur  D shade  B pale  P pink  K eye  W white
// The head keeps the 8bit cat's stair-step ears and square skull, with one pixel knocked off
// the corners, a pale muzzle and a shaded chin line instead of an outline.
const CAT_HEAD = [
".SS.........SS.",
".SPS.......SPS.",
".SPPS.....SPPS.",
".SSSSSSSSSSSSS.",
"SSSSSSSSSSSSSSS",
"SSSSSSSSSSSSSSS",
"SSSSSSSSSSSSSSS",
"SSSSSSBPBSSSSSS",
"SSSSSBBBBBSSSSS",
"SSSSSBBBBBSSSSS",
".SSSSSBBBSSSSS.",
"..DDDDDDDDDDD..",
];
// The head is drawn centred on the cat: HEAD_X is its left edge relative to the centre column.
const HEAD_W = CAT_HEAD[0].length, HEAD_X = -(HEAD_W - 1) / 2;
// A cat glances to one side: the features of its face sit a pixel off-centre. `shiftLeft`
// moves the interior of a head row (columns from..to) one pixel left, filling with fur.
function shiftLeft(row, from, to) {
  return row.slice(0, from) + row.slice(from + 1, to + 1) + "S" + row.slice(to + 1);
}
// When app.js turns the cat (it looks the other way now and then), the whole cat is drawn
// mirrored about its centre: a pen that flips every rect across `axis2 / 2`.
function mirrored(g, axis2) {
  return {rect(x, y, w, h, color) { g.rect(axis2 - x - w, y, w, h, color); }};
}
// the head with its muzzle a pixel to the left, for the glance
const CAT_HEAD_LOOK = CAT_HEAD.map((row, r) => r >= 7 && r <= 10 ? shiftLeft(row, 1, 13) : row);
// faces are overlays on the head; `y` is the head row they start at
const FACES = {
  caret: {y: 6, rows: [          // the 8bit cat's happy carets
    "...K.......K...",
    "..K.K.....K.K..",
  ]},
  closed: {y: 7, rows: [         // blink, and the eyes-shut sip
    "..KKK.....KKK..",
  ]},
  wide: {y: 5, rows: [
    "..WWW.....WWW..",
    "..WKW.....WKW..",
    "..WWW.....WWW..",
  ]},
};
// mouths are overlays too, starting at head row 8, on the pale muzzle under the nose
const MOUTH_SMILE = [       // a small V under the nose: corners up, three pixels, in a soft dark
"......M.M......",
".......M.......",
];
const MOUTH_OPEN = [        // startled
".......M.......",
".......M.......",
];
const CAT_BODY = [
"....SSSSSSS....",
"...SSSSSSSSS...",
"...SSSBBBSSS...",
"..SSSBBBBBSSS..",
"..SSSBBBBBSSS..",
".SSSSBBBBBSSSS.",
".SSSSSBBBSSSSD.",
"SSSSDSSSSSDSSDD",
"SSSSDSSDSSDSSDD",
"SSSDBBBDBBBDSDD",
".DDDBBBDBBBDDD.",
];
// the 8bit cat's thick upright tail, with two bands and a join at the bottom
const CAT_TAIL_A = [
"..SS.",
".SSS.",
".DDD.",
".SSS.",
".SSS.",
".DDD.",
".SSD.",
".SSD.",
"SSSD.",
"SDD..",
];
const CAT_TAIL_B = [
"...SS",
"..SSS",
"..DDD",
".SSS.",
".SSS.",
".DDD.",
".SSD.",
".SSD.",
"SSSD.",
"SDD..",
];
const CAT_TAIL_PUFF = [
"..S.S.",
".SSSS.",
"SDDDDS",
".SSSS.",
"SSSSSS",
".DDDD.",
"SSSSSS",
".SSSD.",
"SSSD..",
"SDD...",
];
// Raised arm: one short, rigid, straight limb from the shoulder to the paw, no elbow. It
// pivots about a fixed shoulder point at the top of the body, right under the chin, and the
// wave is purely a change of angle: the paw centre sits ARM_LENGTH from the shoulder in both
// frames, so the paw swings along an arc and the arm never changes length. The limb is about
// 3.4 px thick at either angle (4 px runs: vertical ones when shallow, horizontal when steep).
// It is drawn behind the head; any arm pixel that touches the head is shaded (the head's
// shadow on the arm), so the two never merge.
const CAT_PAW_UP = [
"SSSSS",
"SPSPS",
"SSPSS",
"SSSSS",
];
const ARM_LENGTH = 8, ARM_ANGLES = [32, 58];                // degrees from horizontal: low, high
// Offsets from the cat's (cx, py): the shoulder pivot, and the paw sprite's top-left.
function raisedArmGeometry(up) {
  const a = ARM_ANGLES[up ? 1 : 0] * Math.PI / 180;
  const shoulder = {x: HEAD_X, y: -10};                      // the column under the head's outer edge
  const paw = {x: Math.round(shoulder.x - ARM_LENGTH * Math.cos(a) - 2), y: Math.round(shoulder.y - ARM_LENGTH * Math.sin(a) - 1.5)};
  const dx = shoulder.x - (paw.x + 2), dy = shoulder.y - (paw.y + 1.5);       // to the drawn paw's centre
  return {shoulder, paw, slope: Math.tan(a), length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) * 180 / Math.PI};
}
function drawRaisedArm(g, x, py, hy, pal, up) {
  const geo = raisedArmGeometry(up), sx = geo.shoulder.x, sy = geo.shoulder.y;
  const onHead = (px, y) => {
    const r = y - hy, c = px - (x + HEAD_X);
    return r >= 0 && r < CAT_HEAD.length && c >= 0 && c < HEAD_W && CAT_HEAD[r][c] !== ".";
  };
  const cells = new Map();
  const put = (ox, oy) => cells.set(ox + "," + oy, [ox, oy]);
  for (let ox = sx + 1; ox <= -5; ox++) put(ox, sy);         // the shoulder reaches in to the chest
  // The laptop hides the body, so give the arm something to join: a strip of flank down the
  // laptop's left side, and (low frame) the two pixels in the notch under the jaw, so no
  // background shows between the arm, the head and the body.
  for (let oy = sy + 1; oy <= -4; oy++) { put(-7, oy); if (oy <= sy + 3) put(-8, oy); }
  if (!up) { put(sx, sy - 2); put(sx + 1, sy - 1); put(sx - 1, sy - 3); }   // the notch moves with the jaw
  if (up) {                                                   // steep: one 4 px run per row
    for (let oy = sy; oy >= geo.paw.y + 3; oy--) {
      const left = Math.round(sx - (sy - oy) / geo.slope - 1.5);
      for (let k = 0; k < 4; k++) put(left + k, oy);
    }
  } else {                                                    // shallow: one 4 px run per column
    for (let ox = sx; ox >= geo.paw.x + 4; ox--) {
      const top = Math.round(sy - (sx - ox) * geo.slope - 1.5);
      for (let k = 0; k < 4; k++) put(ox, top + k);
    }
  }
  for (const [ox, oy] of cells.values()) {
    const px = x + ox, y = py + oy;
    if (onHead(px, y)) continue;                              // behind the head
    // Shade only away from the shoulder: the join itself (the shoulder row, and the first two
    // columns of the limb) stays pure fur colour so nothing dark cuts the arm from the body.
    const atJoin = oy === sy || ox >= sx - 1;
    const touching = onHead(px + 1, y) || onHead(px, y - 1) || onHead(px - 1, y) || onHead(px, y + 1);
    const under = !cells.has(ox + "," + (oy + 1));
    g.rect(px, y, 1, 1, !atJoin && (touching || under) ? pal.D : pal.S);
  }
  sprite(g, CAT_PAW_UP, x + geo.paw.x, py + geo.paw.y, pal);
  // where the paw sits one pixel off the cheek, that pixel is the head's shadow, not background
  for (let r = 0; r < CAT_PAW_UP.length; r++) {
    const px = x + geo.paw.x + 5, y = py + geo.paw.y + r;
    if (!onHead(px, y) && onHead(px + 1, y)) g.rect(px, y, 1, 1, pal.D);
  }
}
const MUG = [               // handle on the right
"UcccU.",
"UUUUuU",
"rrrrrU",
"UUUUu.",
".UUu..",
];
const STEAM_A = [".s", "s.", ".s"];
const STEAM_B = ["s.", ".s", "s."];
// asleep: the 8bit cat's side-on loaf, head on the left, with a tail wrapped along the front
const CAT_SLEEP_A = [
".SS.....SS............",
".SPS...SPS....SSSSS...",
".SPPS.SPPS..SSSSSSSSS.",
"SSSSSSSSSSSSSSSSSSSSSS",
"SSSSSSSSSSSSSSSSSSSSSD",
"SSSSSSSSSSSDSSSSSSSSSD",
"SKSKSSSKSKSDSSSSSSSSSD",
"SSKSBPBSKSSDSSSSSSSSDD",
".SSSMBMSSSDSSSSSSSDDDD",
".BBBDDDBBBDSSDSSDSSSD.",
"..DDDDDDDDDDDDDDDDDD..",
];
const CAT_SLEEP_B = [       // breathing in: the flank swells one pixel
".SS.....SS....SSSSS...",
".SPS...SPS..SSSSSSSSS.",
".SPPS.SPPS.SSSSSSSSSSS",
"SSSSSSSSSSSSSSSSSSSSSS",
"SSSSSSSSSSSSSSSSSSSSSD",
"SSSSSSSSSSSDSSSSSSSSSD",
"SKSKSSSKSKSDSSSSSSSSSD",
"SSKSBPBSKSSDSSSSSSSSDD",
".SSSMBMSSSDSSSSSSSDDDD",
".BBBDDDBBBDSSDSSDSSSD.",
"..DDDDDDDDDDDDDDDDDD..",
];

function paw(g, x, y, pal) { g.rect(x, y, 3, 2, pal.B); g.rect(x, y + 2, 3, 1, pal.D); }

// state: working | thinking | waiting | raising | asleep | startled
// (cx, py): the centre column and the y of the surface the cat sits on.
// opts: laptop (a mode, or null for none), blink, sip, pending, flash
function drawCatAt(g, cx, py, accent, state, frame, opts) {
  const pal = catPalette(accent);
  const beat = frame % 2;
  const slow = Math.floor(frame / 3) % 2;
  if (state === "asleep") {
    if (opts.laptop) drawLaptop(g, cx + 9, py, accent, "closed", frame);
    sprite(g, slow ? CAT_SLEEP_B : CAT_SLEEP_A, cx - 14, py - 11, pal);
    return;
  }
  const startled = state === "startled";
  // everything but the laptop flips when the cat is turned; a startled cat stares straight ahead
  const laptopPen = g;
  if (opts.turned) g = mirrored(g, 2 * cx + 1);
  const look = startled ? 0 : -1;
  const shake = startled ? (beat ? 1 : -1) : 0;
  const bob = state === "working" && beat ? 1 : 0;
  const x = cx + shake;
  if (startled) sprite(g, CAT_TAIL_PUFF, x + 7, py - 10, pal);
  else {
    const flick = state === "working" ? slow : Math.floor(frame / 4) % 2;
    sprite(g, flick ? CAT_TAIL_B : CAT_TAIL_A, x + 8, py - 10, pal);
  }
  sprite(g, CAT_BODY, x - 7, py - 11, pal);
  const hy = py - 22 + bob + (startled ? -1 : 0);
  if (state === "raising") drawRaisedArm(g, x, py, hy, pal, Math.floor(frame / 2) % 2);
  sprite(g, startled ? CAT_HEAD : CAT_HEAD_LOOK, x + HEAD_X, hy, pal);
  if (startled) {
    // fur standing on end: single pixels poking out of the silhouette, as in 8bit
    for (const [dx, dy] of [[-8, 4], [-9, 6], [-8, 8], [8, 4], [9, 6], [8, 8], [-2, 2], [0, 1], [0, 2], [2, 2]])
      g.rect(x + dx, hy + dy, 1, 1, pal.S);
    for (const [dx, dy] of [[-8, -8], [-9, -5], [-8, -2]]) g.rect(x + dx, py + dy, 1, 1, pal.S);
  }
  const sip = state === "waiting" && opts.sip;
  // the sip shuts its eyes, so it differs from plain waiting
  const face = startled ? "wide" : sip || opts.blink ? "closed" : "caret";
  sprite(g, FACES[face].rows, x + HEAD_X + look, hy + FACES[face].y, pal);
  sprite(g, startled ? MOUTH_OPEN : MOUTH_SMILE, x + HEAD_X + look, hy + 8, pal);
  if (opts.laptop) drawLaptop(laptopPen, cx, py, accent, opts.laptop, frame, opts.pending, opts.flash);
  // paws and props in front of the laptop
  if (!opts.laptop && state !== "waiting") {
    /* no laptop: the body bitmap already has its paws */
  } else if (state === "working") {
    paw(g, x - 9, py - 4 - (beat ? 1 : 0), pal);
    paw(g, x + 7, py - 4 - (beat ? 0 : 1), pal);
  } else if (state === "waiting") {
    if (!sip) paw(g, x + 7, py - 4, pal);
    if (sip) {
      sprite(g, MUG, x - 11, hy + 8, pal, true);            // lifted to the mouth from the side
      g.rect(x - 10, hy + 13, 3, 2, pal.B); g.rect(x - 9, hy + 15, 3, 2, pal.S); g.rect(x - 8, hy + 17, 3, 1, pal.D);
    } else {
      sprite(g, MUG, x - 14, py - 8, pal, true);
      paw(g, x - 9, py - 6, pal);
      sprite(g, beat ? STEAM_B : STEAM_A, x - 12, py - 12, {s: "#fffaf0"});
    }
  } else if (state === "raising") {
    paw(g, x + 7, py - 4, pal);
  } else {
    paw(g, x - 9, py - 4, pal);
    paw(g, x + 7, py - 4, pal);
  }
  if (startled) { g.rect(cx + 11, hy + 1, 2, 5, "#d8503c"); g.rect(cx + 11, hy + 7, 2, 2, "#d8503c"); }
}

// ============================================================ KITTENS
const KIT_HEAD = [
"SS.....SS",
"SPS...SPS",
"SSSSSSSSS",
"SKSSSSSKS",
"KSKSSSKSK",
"SSSBPBSSS",
".SSMBMSS.",
];
const KIT_SIT_BODY = [
"..DDDDD...S",
".SSSBSSS.SD",
"SSSBBBSSSD.",
"SBBD.DBBD..",
];
// side-on body for the floor game: level, and rump up for the pounce
const KIT_SIDE_A = [
"S.........",
"S.........",
"SS........",
".SSSSSSSS.",
".SSSSSSSSS",
".SSDSSSSSD",
".BB....BB.",
];
const KIT_SIDE_B = [
".S........",
"S.........",
"SSSSSS....",
"SSSSSSSS..",
".SSSSSSSS.",
".SSD.DDDDD",
".BB.......",
];

// working: sits beside the trunk batting a little yarn ball. `side` is which side of the
// trunk it sits on (-1 left, +1 right); the ball is on its outer side, the tail on the inner.
function drawKittenWork(g, cx, by, accent, frame, side, yarnColor) {
  const pal = catPalette(accent);
  const f = frame % 2, out = side < 0 ? -1 : 1;
  sprite(g, KIT_SIT_BODY, out < 0 ? cx - 4 : cx - 6, by - 4, pal, out > 0);
  sprite(g, KIT_HEAD, cx - 4, by - 11 + (f ? 1 : 0), pal);
  // the ball: nudged out and up on the hit frame
  const bx = out < 0 ? cx - 10 - (f ? 0 : 1) : cx + 7 + (f ? 0 : 1);
  drawMiniYarn(g, bx, by - 4 - (f ? 0 : 2), yarnColor || "#f7d64a", f);
  // batting paw: wound up by the cheek, then down on the ball
  g.rect(out < 0 ? cx - 6 : cx + 5, f ? by - 6 : by - 3, 2, 2, pal.B);
}
// playing on the floor, side-on, facing the way `flip` says (true: left)
function drawKittenPlay(g, cx, by, accent, frame, flip) {
  const pal = catPalette(accent);
  const f = frame % 2;
  sprite(g, f ? KIT_SIDE_B : KIT_SIDE_A, flip ? cx - 2 : cx - 8, by - 7, pal, flip);
  const hx = flip ? cx - 7 : cx - 2;
  sprite(g, KIT_HEAD, hx, by - 9 + (f ? 2 : 0), pal, flip);
  if (f) { g.rect(flip ? hx - 2 : hx + 9, by - 2, 2, 2, pal.B); g.rect(hx + (flip ? 3 : 4), by - 1, 2, 1, pal.B); }
}

// Errands. At a bowl: sitting up behind the dish, bobbing its head down into it (eyes shut,
// muzzle behind the bowl's front) and back up. (cx, by): the bowl's centre and the
// kitten's feet, behind the bowl; `flip` puts its tail on the left.
const KIT_HEAD_DOWN = [         // eyes shut and set high: the rest of the face is in the dish
"SS.....SS",
"SPS...SPS",
"SSSSSSSSS",
"SKKSSSKKS",
"SSSSSSSSS",
"SSSBPBSSS",
".SSBBBSS.",
];
function drawKittenAtBowl(g, cx, by, accent, frame, flip) {
  const pal = catPalette(accent), dipped = frame % 2 === 1;
  sprite(g, KIT_SIT_BODY, flip ? cx - 6 : cx - 4, by - 4, pal, flip);
  if (dipped) sprite(g, KIT_HEAD_DOWN, cx - 4, by - 7, pal);       // four pixels down
  else sprite(g, KIT_HEAD, cx - 4, by - 11, pal);
}
// Swatting at the plant: standing, head up, one front paw raised and batting at the leaves
// (wound up, then swiped down and forward). Drawn facing right from (cx, by).
const KIT_SWAT = [
[ // wound up beside the face
"..BBB..",
"..BPB..",
"..SS...",
"..SS...",
".SS....",
".SS....",
"SS.....",
"SS.....",
  ],
[ // swiped down and forward into the leaves
".......",
".......",
"....BBB",
"...SBPB",
"..SS...",
".SS....",
"SS.....",
"SS.....",
  ],
];
function drawKittenSwatting(g, cx, by, accent, frame, flip) {
  const pal = catPalette(accent), f = frame % 2;
  const at = (x, w) => flip ? 2 * cx - x - w + 1 : x;        // mirror about cx
  sprite(g, KIT_SIDE_A, at(cx - 8, 10), by - 7, pal, flip);
  sprite(g, KIT_HEAD, at(cx - 1, 9), by - 11, pal, flip);
  sprite(g, KIT_SWAT[f], at(cx + 7, 7), by - 13, pal, flip);
  if (f) g.rect(at(cx + 15, 2), by - 13, 2, 1, "#63b257");     // a leaf knocked loose
}
// Napping in the sunbeam: curled up, eyes shut, tail wrapped round the front; the flank
// rises and falls.
const KIT_NAP = [
  [
"SS.....SS.......",
"SPS...SPS.SSSS..",
"SSSSSSSSSSSSSSS.",
"SSSSSSSSSDSSSSSD",
"SKKSSSKKSDSSSSSD",
"SSSBPBSSSDSSSSDD",
".BBMBMBBDSSDSSD.",
"..DDDDDDDDDDDD..",
  ],
  [
"SS.....SS.SSSS..",
"SPS...SPSSSSSSS.",
"SSSSSSSSSSSSSSSS",
"SSSSSSSSSDSSSSSD",
"SKKSSSKKSDSSSSSD",
"SSSBPBSSSDSSSSDD",
".BBMBMBBDSSDSSD.",
"..DDDDDDDDDDDD..",
  ],
];
function drawKittenNapping(g, cx, by, accent, frame) {
  sprite(g, KIT_NAP[Math.floor(frame / 3) % 2], cx - 8, by - 8, catPalette(accent));
}

// ============================================================ THE ADOPTION MAN
// H skin  h shine  N skin shade  G glasses  w lens  K eye/mouth
// W shirt  v shirt shade  T tie  t tie shade  Z belt  B trousers  b shade  E shoe
const MAN_TOP = [
"....HHHHHHH....",
"...HhhHHHHHN...",
"..HHhHHHHHHHN..",
"..HGGGGHGGGGN..",
".HHGwwGGGwwGNH.",
".HHGwKGHGwKGNH.",
"..HGGGGHGGGGN..",
"..HHHHHHHHHHN..",
"...HHHmHmHHN...",
"....HHHmHNN....",
".....WWTWW.....",
"...WWWWTWWWv...",
"..WWWWWTWWWWv..",
".WWvWWWTWWWvWW.",
".WWvWWWTWWWvWv.",
".WWvWWWTWWWvWv.",
".WWvWWWtWWWvWv.",
".WWvWWWWWWWvWv.",
".HHvWWWWWWWvHH.",
"...ZZZZZZZZZ...",
];
const MAN_LEGS_WALK = [
"...BBBBBBBBb...",
"...BBBBBBBBb...",
"...BBBb.BBBb...",
"...BBBb.BBBb...",
"...BBBb.BBBb...",
"...BBBb.BBBb...",
"...BBBb.BBBb...",
"...BBBb.BBBb...",
"...BBBb.BBBb...",
"...BBBb.EEEEE..",
"..EEEEE........",
];
const MAN_PAL = {m: "#a5604e", H: "#eebb95", h: "#f8d9bd", N: "#d39c78", G: "#3a3230", w: "#e6f2f4", K: "#3a2a2e",
  W: "#fcfbf6", v: "#d8dadd", T: "#cc3f36", t: "#9e2f30", Z: "#4a3a34", B: "#555666", b: "#40414f", E: "#3a2c2a"};
// the cat in his arms: a small sleeping loaf (cat palette)
const CAT_CARRIED = [
"SS.....SS",
"SPS...SPS",
"SSSSSSSSS",
"SSSSSSSSS",
"SKKSSSKKS",
"SSSBPBSSS",
"SSSBBBSSS",
".SSSSSSS.",
".SSSSSSS.",
];

// (cx, feetY): centre column and the floor line. `carrying` is an accent colour or null;
// `flip` mirrors him (he is lit from the side he came in on).
function drawManAt(g, cx, feetY, frame, carrying, flip) {
  const f = frame % 2;
  const x = cx - 7, legsY = feetY - 11, topY = legsY - MAN_TOP.length + (f ? 0 : 1);
  sprite(g, MAN_LEGS_WALK, x, legsY, MAN_PAL, f === 1);
  sprite(g, MAN_TOP, x, topY, MAN_PAL, flip);
  if (carrying) {
    const pal = catPalette(carrying);
    const cy = topY + 9;
    sprite(g, CAT_CARRIED, cx - 4, cy, pal);
    // both sleeves come across under the cat, hands meeting in the middle
    g.rect(cx - 6, cy + 7, 5, 2, MAN_PAL.W); g.rect(cx + 2, cy + 7, 5, 2, MAN_PAL.v);
    g.rect(cx - 1, cy + 7, 3, 2, MAN_PAL.H); g.rect(cx + 1, cy + 8, 1, 1, MAN_PAL.N);
    g.rect(cx + 3, cy + 9, 2, 3, pal.S); g.rect(cx + 3, cy + 10, 2, 1, pal.D);      // tail hanging down
  }
}


// ============================================================ LAPTOP
// modes: closed | open | lit | spinner. (cx, py): centre column of the base, surface y.
function drawLaptop(g, cx, py, accent, mode, frame, pending, flash) {
  const deck = "#8d9299", deckL = "#bcc1c8", lid = "#3d4047";
  if (mode === "closed") {
    g.rect(cx - 6, py - 2, 13, 2, lid); g.rect(cx - 6, py - 2, 13, 1, "#565a63");
    g.rect(cx, py - 2, 1, 1, mix(accent, "#ffffff", 0.3));
    return;
  }
  const lit = mode === "lit", spin = mode === "spinner";
  g.rect(cx - 6, py - 9, 13, 7, lid);                           // lid
  g.rect(cx - 5, py - 8, 11, 5, lit ? "#14283a" : spin ? "#1a2030" : "#25282f");
  g.rect(cx - 7, py - 2, 15, 2, deck); g.rect(cx - 7, py - 2, 15, 1, deckL);   // deck
  if (lit) {
    g.rect(cx - 6, py - 10, 13, 1, accent);                     // glow strip on the lid
    const colors = ["#6fc4ff", "#ffd66b", "#6fc4ff"];
    for (let i = 0; i < 3; i++) {
      const k = (frame + i) % 3;
      g.rect(cx - 4 + [0, 1, 1][k], py - 8 + i * 2, [7, 4, 6][k], 1, colors[k]);
    }
  } else if (spin) {
    if (flash) {
      g.rect(cx - 5, py - 8, 11, 5, "#3f9a55");
      for (const [dx, dy] of [[-2, -6], [-1, -5], [0, -6], [1, -7], [2, -7]]) g.rect(cx + dx, py + dy, 1, 1, "#eaffea");
      return;
    }
    const ring = [[0, -1], [1, -1], [2, 0], [2, 1], [1, 2], [0, 2], [-1, 1], [-1, 0]];
    for (let i = 0; i < 8; i++) {
      const age = ((frame - i) % 8 + 8) % 8;
      if (age > 2) continue;
      g.rect(cx - 3 + ring[i][0], py - 7 + ring[i][1], 1, 1, age === 0 ? "#bfe6ff" : "#4a86c0");
    }
    for (let d = 0; d < Math.min(3, pending || 0); d++) g.rect(cx + 3, py - 8 + d * 2, 2, 1, "#f7d64a");
  } else {
    g.rect(cx - 4, py - 7, 2, 1, "#4a5060");                    // idle cursor
  }
}

// ============================================================ SMALL PROPS
const YARN = [
".aaaa.",
"ahaaba",
"aaabaa",
"abbaab",
"aaaaba",
".aaaa.",
];
const YARN_MINI_A = [".aa.", "ahba", "abaa", ".aa."];
const YARN_MINI_B = [".aa.", "abha", "aaba", ".aa."];
function yarnPal(color) { return {a: color, b: mix(color, "#2a1840", 0.36), h: mix(color, "#ffffff", 0.55)}; }
function drawYarn(g, x, y, color) {
  const pal = yarnPal(color);
  for (const [dx, dy] of [[6, 5], [7, 5], [8, 4], [9, 5], [10, 5]]) g.rect(x + dx, y + dy, 1, 1, pal.b);   // loose strand
  sprite(g, YARN, x, y, pal);
}
function drawMiniYarn(g, x, y, color, f) {
  const pal = yarnPal(color);
  for (const [dx, dy] of (f ? [[4, 3], [5, 3]] : [[-1, 3], [-2, 3]])) g.rect(x + dx, y + dy, 1, 1, pal.b);
  sprite(g, f ? YARN_MINI_B : YARN_MINI_A, x, y, pal);
}
const BOWLS = {water: ["#6db5e8", "#a6d6f5"], food: ["#b9744c", "#d0916a"]};
// one bowl, (x, y) the top-left of its rim; `frontOnly` redraws just the rim and body, over
// a kitten whose face is in the bowl
function drawBowl(g, x, y, kind, frontOnly) {
  g.rect(x, y, 10, 2, "#fffaf0"); g.rect(x + 1, y + 2, 8, 2, "#fffaf0");
  g.rect(x + 8, y + 1, 2, 1, "#dfd3c0"); g.rect(x + 7, y + 2, 2, 2, "#dfd3c0");
  if (frontOnly) return;
  const [fill, fillL] = BOWLS[kind];
  g.rect(x + 1, y - 1, 8, 1, fill); g.rect(x + 2, y - 1, 3, 1, fillL);
}
function drawBowls(g, x, y) {            // (x, y): top-left of the water bowl's rim
  g.rect(x - 1, y + 4, 24, 1, "#b98a66");                                        // mat
  drawBowl(g, x, y, "water");
  drawBowl(g, x + 12, y, "food");
}

function drawPlant(g, x, y) {            // (x, y) = bottom-left of the pot
  const g1 = "#3c9440", g2 = "#2f7d33", g3 = "#63b257";
  g.rect(x + 1, y, 8, 1, "rgba(70,36,24,0.20)");
  // leaves: three chunky blades with stepped tips
  g.rect(x + 1, y - 13, 2, 7, g2); g.rect(x, y - 12, 1, 3, g2);
  g.rect(x + 5, y - 14, 2, 8, g1); g.rect(x + 7, y - 13, 1, 4, g1);
  g.rect(x + 3, y - 16, 2, 10, g1); g.rect(x + 3, y - 16, 1, 9, g3);
  g.rect(x + 5, y - 13, 1, 5, g3);
  // flowers
  g.rect(x - 1, y - 15, 3, 3, "#f2a0b8"); g.rect(x, y - 14, 1, 1, "#f7d64a");
  g.rect(x + 6, y - 17, 3, 3, "#e8677a"); g.rect(x + 7, y - 16, 1, 1, "#f7d64a");
  // pot
  g.rect(x, y - 7, 9, 2, "#d08a60"); g.rect(x, y - 7, 9, 1, "#e2a57c");
  g.rect(x + 1, y - 5, 7, 5, "#c47a52"); g.rect(x + 6, y - 5, 2, 5, "#a05f3e"); g.rect(x + 2, y - 1, 5, 1, "#a05f3e");
}

function drawHangingPlant(g, x) {        // x = left edge; hangs from the ceiling
  g.rect(x + 4, 0, 1, 3, "#8a5f3c");
  g.rect(x + 1, 3, 1, 2, "#8a5f3c"); g.rect(x + 7, 3, 1, 2, "#8a5f3c"); g.rect(x + 2, 2, 5, 1, "#8a5f3c");
  g.rect(x + 2, 3, 5, 2, "#3c9440"); g.rect(x + 3, 3, 2, 1, "#63b257");                // foliage above the rim
  g.rect(x, 5, 9, 2, "#d08a60"); g.rect(x, 5, 9, 1, "#e2a57c");
  g.rect(x + 1, 7, 7, 3, "#c47a52"); g.rect(x + 6, 7, 2, 3, "#a05f3e"); g.rect(x + 2, 10, 5, 1, "#a05f3e");
  const vines = [[x, 17], [x + 4, 9], [x + 8, 13]];
  vines.forEach(([vx, len], vi) => {
    const top = vi === 1 ? 11 : 7;
    g.rect(vx, top, 1, len, "#2f7d33");
    for (let ly = top + 2, n = vi; ly < top + len; ly += 4, n++) {
      const left = n % 2 === 0;
      g.rect(left ? vx - 2 : vx + 1, ly, 2, 2, left ? "#4aa64e" : "#3c9440");
      g.rect(left ? vx - 2 : vx + 2, ly, 1, 1, "#7cc46a");
    }
  });
}

function drawBunting(g, w) {
  const colors = ["#f2a0b8", "#a8d8c0", "#f7d64a", "#c3b2e2", "#f2b48a"];
  g.rect(0, 1, w, 1, "#a47a55");
  for (let i = 0, x = 3; x < w - 4; x += 10, i++) {
    const c = colors[i % colors.length], d = mix(c, "#5a2a40", 0.22);
    g.rect(x, 2, 5, 2, c); g.rect(x + 1, 4, 3, 2, c); g.rect(x + 2, 6, 1, 1, c);
    g.rect(x + 4, 2, 1, 2, d); g.rect(x + 3, 4, 1, 2, d);
  }
}

// ============================================================ CAT TREE
// (cx, baseY): centre column and top of the base slab. `post` = post height.
const PLATFORM_H = 6, LEVEL = 12, KITTEN_OUT = 21;
function treeGeometry(cx, baseY, post) {
  const platformY = baseY - post - PLATFORM_H;
  return {platformY, seatY: platformY};
}
// where working kitten `index` of a tree sits: alternating sides, one per level
function kittenSlot(cx, baseY, index) {
  const side = index % 2 === 0 ? -1 : 1;
  return {cx: cx + side * KITTEN_OUT, bottom: baseY + 4 - index * LEVEL, side};
}
function drawTree(g, cx, baseY, post, accent, frame, perches) {
  const py = baseY - post - PLATFORM_H;
  const slab = "#a5744a", slabL = "#c3925f", slabD = "#80573a";
  g.rect(cx - 14, baseY + 4, 29, 1, "rgba(70,36,24,0.22)");                     // floor shadow
  // post: sisal with rope bands and one shaded side
  const top = py + PLATFORM_H;
  g.rect(cx - 3, top, 7, baseY - top, "#dcbd8e");
  g.rect(cx - 3, top, 1, baseY - top, "#ebd5a9");
  g.rect(cx + 2, top, 2, baseY - top, "#c8a877");
  for (let y = top + 3; y < baseY - 1; y += 3) { g.rect(cx - 3, y, 5, 1, "#c5a577"); g.rect(cx + 2, y, 2, 1, "#ae8e60"); }
  g.rect(cx - 3, top, 7, 1, "#b08e62");                                         // shadow under the platform
  // a step off the trunk for each working kitten above the floor
  for (let i = 1; i < (perches || 0); i++) {
    const k = kittenSlot(cx, baseY, i), x0 = k.side < 0 ? cx - 30 : cx + 4;
    g.rect(x0, k.bottom, 27, 2, slab); g.rect(x0, k.bottom, 27, 1, slabL);
    g.rect(k.side < 0 ? cx - 6 : cx + 4, k.bottom + 2, 3, 1, slabD);            // bracket
  }
  // base slab
  g.rect(cx - 13, baseY, 27, 4, slab); g.rect(cx - 13, baseY, 27, 1, slabL); g.rect(cx - 13, baseY + 3, 27, 1, slabD);
  // platform: 8bit's wooden block with a cream inset, the cushion tinted by the cat's colour
  const cush = mix(accent || "#e0c9a0", "#fff3dc", 0.68), cushL = mix(cush, "#ffffff", 0.45);
  g.rect(cx - 16, py, 33, PLATFORM_H, slab);
  g.rect(cx - 16, py + PLATFORM_H - 1, 33, 1, slabD);
  g.rect(cx - 15, py, 31, 2, cush); g.rect(cx - 15, py, 31, 1, cushL);
  g.rect(cx - 16, py + 2, 33, 1, slabL);
}

// ============================================================ ROOM
function drawRoom(g, w) {
  // wall: flat, with a quiet wide stripe
  g.rect(0, 0, w, WALL_H, "#f4dcbc");
  for (let x = 6; x < w; x += 16) g.rect(x, 0, 8, 36, "#f1d6b3");
  // wainscot: rail, boards with a groove and a highlight, baseboard
  const top = 36;
  g.rect(0, top, w, 2, "#c69669"); g.rect(0, top, w, 1, "#e3bb90");
  g.rect(0, top + 2, w, WALL_H - top - 2, "#dbad82");
  for (let x = 4; x < w; x += 10) { g.rect(x, top + 2, 1, 6, "#c4946a"); g.rect(x + 1, top + 2, 1, 6, "#e4ba92"); }
  g.rect(0, WALL_H - 2, w, 2, "#b58458"); g.rect(0, WALL_H - 1, w, 1, "#94694a");
  // floor: staggered planks in close tones with faint seams, so it sits quietly under the cats
  const PH = 8, PL = 58, SEAM = "#bb9175";
  for (let y = WALL_H, row = 0; y < H; y += PH, row++) {
    const offset = (row * 23) % PL;
    for (let x = -offset, n = 0; x < w; x += PL, n++) {
      const r = hash(row, n);
      const tone = r > 0.78 ? "#cca485" : (row + n) % 2 ? "#c69d7f" : "#c9a081";
      g.rect(x, y, PL, PH, tone);
      g.rect(x, y, 1, PH, SEAM);
      if (r < 0.25) g.rect(x + 8 + Math.floor(r * 140), y + 4, 6, 1, mix(tone, "#8a5a3c", 0.08));  // one grain dash
    }
    g.rect(0, y, w, 1, SEAM);
  }
  g.rect(0, WALL_H, w, 1, "#8f6850");                                           // the wall's shadow line
}

// sunlight falling through the window onto the floor
function drawSunbeam(g, x, state) {
  const color = ["rgba(235,245,255,0.10)", "rgba(255,240,180,0.17)", "rgba(255,205,120,0.24)"][state];
  for (let i = 0; i < 32; i += 2) {
    const sx = x + 8 + Math.floor(i * 0.75);
    g.rect(sx, WALL_H + 4 + i, 22, 2, color); g.rect(sx + 25, WALL_H + 4 + i, 22, 2, color);
  }
}

// ------------------------------------------------------------ window (CPU)
// state: 0 cool, 1 warm, 2 hot. (x, y): top-left of the frame.
const WIN_W = 50, WIN_H = 28;
function windowState(load) { return load >= 70 ? 2 : load >= 35 ? 1 : 0; }
function cloud(g, x, y, w) {
  g.rect(x + 3, y, w - 7, 2, "#ffffff"); g.rect(x + 1, y + 1, w - 2, 2, "#ffffff"); g.rect(x, y + 2, w, 2, "#ffffff");
  g.rect(x + 1, y + 4, w - 2, 1, "#d6e6ef");
}
function drawWindow(g, x, y, state, frame) {
  const f = (frame || 0) % 2;
  const gx = x + 2, gy = y + 2, gw = 46, gh = 22;
  g.rect(x, y, WIN_W, 26, WOOD); g.rect(x, y, WIN_W, 1, WOOD_L);
  g.rect(gx, gy, gw, gh, ["#b4dff2", "#9ad6f3", "#f6bf88"][state]);                 // sky
  g.rect(gx, gy + 10, gw, gh - 10, ["#cdeaf6", "#c4e6f5", "#fad7a0"][state]);
  // the sun: a chunky block with its corners knocked off and a lighter core
  const sx = gx + 11, sy = gy + 9;
  if (state === 0) {
    blob(g, sx - 3, sy - 3, 6, 6, "#f4e29a"); g.rect(sx - 2, sy - 2, 4, 4, "#faf0c0");
    cloud(g, gx + 9, gy + 9, 13); cloud(g, gx + 27, gy + 4, 11); cloud(g, gx + 33, gy + 11, 12);
  } else if (state === 1) {
    const ray = "#f7c93e";
    g.rect(sx - 8, sy - 1, 2, 2, ray); g.rect(sx + 6, sy - 1, 2, 2, ray); g.rect(sx - 1, sy - 8, 2, 2, ray); g.rect(sx - 1, sy + 6, 2, 2, ray);
    blob(g, sx - 4, sy - 4, 8, 8, ray); g.rect(sx - 2, sy - 2, 4, 4, "#fbe48a");
    cloud(g, gx + 30, gy + 5, 11);
  } else {
    const ray = "#ff9d2e", L = f ? 3 : 2;
    g.rect(sx - 6 - L - 1, sy - 1, L, 2, ray); g.rect(sx + 7, sy - 1, L, 2, ray);
    g.rect(sx - 1, sy - 6 - L - 1, 2, L, ray); g.rect(sx - 1, sy + 7, 2, L, ray);
    const dd = f ? 7 : 6;
    for (const [ux, uy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]])
      g.rect(sx + (ux > 0 ? dd - 1 : -dd - 1), sy + (uy > 0 ? dd - 1 : -dd - 1), 2, 2, ray);
    blob(g, sx - 5, sy - 5, 10, 10, ray, 2); blob(g, sx - 3, sy - 3, 6, 6, "#ffd23e");
    g.rect(sx - 2, sy - 2, 2, 1, "#ffec9a");
    for (let i = 0; i < 2; i++) g.rect(gx + 29 + i * 7 + (f ? 1 : 0), gy + 5 + i * 4, 5, 1, "#fbe0b0");   // heat shimmer
  }
  // one stepped hill and a strip of lawn
  const hill = ["#a8d8a0", "#9ad38e", "#c9c476"][state], lawn = ["#8cc68a", "#7cbf74", "#aeb05a"][state];
  const prof = [1, 2, 3, 3, 4, 4, 4, 3, 3, 2, 2, 1, 1, 1, 2, 3, 4, 5, 5, 5, 4, 3, 2];
  prof.forEach((h, i) => g.rect(gx + i * 2, gy + gh - 3 - h, 2, h + 3, hill));
  g.rect(gx, gy + gh - 2, gw, 2, lawn);
  // glass shine: one stepped streak
  g.rect(gx + 41, gy + 2, 2, 2, "rgba(255,255,255,0.45)"); g.rect(gx + 39, gy + 4, 2, 2, "rgba(255,255,255,0.45)");
  g.rect(gx, gy, gw, 1, "rgba(60,30,20,0.18)");
  g.rect(gx + 22, gy, 2, gh, WOOD); g.rect(gx + 22, gy, 1, gh, WOOD_L);            // mullion
  g.rect(x - 2, y + 26, WIN_W + 4, 2, WOOD_L); g.rect(x - 2, y + 27, WIN_W + 4, 1, WOOD_D);   // sill
}

// ------------------------------------------------------------ pastry case (docker)
// Three chunky cake shapes, coloured per slot as in 8bit.  a cake  b shade  w icing  r cherry
const CAKE_COLORS = ["#f2a0b8", "#a8d8a0", "#f7d64a", "#c3b2e2", "#f2b48a", "#a6dcf5"];
const CAKES = [
  [ // layer cake
"....r....",
".wwwwwww.",
"wwwwwwwww",
"wawwawwaw",
"aaaaaaaab",
"wwwwwwwww",
"aaaaaaaab",
"aaaaaaabb",
  ],
  [ // cupcake
"....r....",
"...www...",
"..wwwww..",
".wwwwwww.",
"wwwwwwwww",
".aabaaba.",
".aabaaba.",
"..abaab..",
  ],
  [ // slice
".........",
"......r..",
"....wwww.",
"..wwwwwww",
"wwwwwwwww",
"aaaaaaaab",
"wwwwwwwww",
"aaaaaaabb",
  ],
];
function drawCake(g, x, y, index, busy, frame) {  // (x, y): top-left of the 9x8 cake
  const kind = index % CAKES.length, color = CAKE_COLORS[index % CAKE_COLORS.length];
  const pal = {a: color, b: mix(color, "#6a3a40", 0.28), w: "#fff5ea", r: busy ? null : "#e05a6a"};
  sprite(g, CAKES[kind], x, y, pal);
  if (busy) {
    const f = (frame || 0) % 2, cx = x + (kind === 2 ? 6 : 4), top = y + (kind === 2 ? 1 : 0);
    g.rect(cx, top - 1, 1, 2, "#fff5ea");
    g.rect(cx, top - 3, 1, 2, f ? "#ffd23e" : "#f28a3c"); g.rect(cx + (f ? 0 : 0), top - 2, 1, 1, f ? "#f28a3c" : "#ffd23e");
  }
}
const CASE_W = 50, CASE_H = 29;
// containers: array of {busy} (up to six)
function drawCase(g, x, y, containers, frame) {
  g.rect(x, y, CASE_W, 3, WOOD); g.rect(x, y, CASE_W, 1, WOOD_L);                 // top
  g.rect(x + 1, y + 3, CASE_W - 2, 22, "#f6e4c9");                                // glass body
  g.rect(x + 1, y + 3, CASE_W - 2, 1, "#e2cba9");
  g.rect(x + 1, y + 13, CASE_W - 2, 1, "#d9bf9c"); g.rect(x + 1, y + 24, CASE_W - 2, 1, "#d9bf9c");   // shelves
  (containers || []).slice(0, 6).forEach((c, i) => {
    if (!c) return;
    drawCake(g, x + 5 + (i % 3) * 15, y + (i < 3 ? 5 : 16), i, c.busy, frame + i);
  });
  for (let i = 0; i < 4; i++) g.rect(x + 9 - i * 2, y + 5 + i * 2, 2, 2, "rgba(255,255,255,0.6)");    // glass shine
  g.rect(x + 1, y + 3, 1, 22, "#fbf1e0"); g.rect(x + CASE_W - 2, y + 3, 1, 22, "#dcc4a0");
  g.rect(x, y + 25, CASE_W, 4, WOOD_D); g.rect(x, y + 25, CASE_W, 1, WOOD);        // base
}

// ------------------------------------------------------------ chalkboard
const BOARD_W = 100, BOARD_H = 30;
// The board's text is the overlay's; boardText() says where it goes.
function drawBoard(g, x, y) {
  g.rect(x, y, BOARD_W, BOARD_H, WOOD_D); g.rect(x, y, BOARD_W, 1, WOOD);
  g.rect(x + 2, y + 2, BOARD_W - 4, BOARD_H - 4, "#434a3e");
  g.rect(x + 2, y + 2, BOARD_W - 4, 1, "#363c33");
  // ledge with two chalks and an eraser
  g.rect(x + 3, y + BOARD_H - 1, BOARD_W - 6, 2, WOOD_L); g.rect(x + 3, y + BOARD_H, BOARD_W - 6, 1, WOOD);
  g.rect(x + 7, y + BOARD_H - 2, 4, 1, "#fffaf2"); g.rect(x + 13, y + BOARD_H - 2, 3, 1, "#f2a0b8");
  g.rect(x + BOARD_W - 16, y + BOARD_H - 3, 7, 2, "#e8c9a0"); g.rect(x + BOARD_W - 16, y + BOARD_H - 3, 7, 1, "#6a5a58");
}

// ------------------------------------------------------------ espresso machine (GPU)
// state: 0 idle, 1 brewing, 2 steaming. (x, y): top-left of the machine; the shelf is drawn too.
function espressoState(pct) { return pct == null || pct <= 5 ? 0 : pct < 60 ? 1 : 2; }
function drawEspresso(g, x, y, state, frame) {
  const f = (frame || 0) % 2, f4 = (frame || 0) % 4;
  const chrome = "#bfc3c4", chromeL = "#dfe3e3", chromeD = "#8f9396", red = "#cf5d52", redL = "#e58a7c";
  const shelfY = y + 17;
  g.rect(x - 4, shelfY, 43, 3, WOOD); g.rect(x - 4, shelfY, 43, 1, WOOD_L); g.rect(x - 4, shelfY + 2, 43, 1, WOOD_D);
  g.rect(x - 1, shelfY + 3, 2, 2, WOOD_D); g.rect(x + 34, shelfY + 3, 2, 2, WOOD_D);
  // body: a chrome block with a cap, lit from the left
  g.rect(x, y + 2, 18, 15, chrome); g.rect(x, y + 2, 1, 15, chromeL); g.rect(x + 16, y + 2, 2, 15, chromeD);
  g.rect(x - 1, y, 20, 2, chromeD); g.rect(x - 1, y, 20, 1, chrome);
  // a red band with a dial and the brew lamp
  g.rect(x + 2, y + 4, 14, 4, red); g.rect(x + 2, y + 4, 14, 1, redL);
  g.rect(x + 3, y + 5, 2, 2, CREAM); g.rect(x + 6, y + 5, 2, 2, CREAM);
  g.rect(x + 12, y + 5, 2, 2, state === 0 ? "#6a4a48" : state === 1 ? (f ? "#ffe07a" : "#f2a03c") : (f ? "#fff3b0" : "#ffb03c"));
  // bay, group head, cup on the tray
  g.rect(x + 3, y + 9, 12, 6, "#4b4347");
  g.rect(x + 6, y + 9, 6, 2, chromeD); g.rect(x + 8, y + 11, 2, 1, "#6a6660"); g.rect(x + 12, y + 10, 4, 1, "#2e282a");
  g.rect(x + 6, y + 12, 5, 3, "#fff5ea"); g.rect(x + 11, y + 13, 1, 1, "#fff5ea");
  if (state > 0) { g.rect(x + 7, y + 12, 3, 1, "#6a4a30"); if (f) g.rect(x + 8, y + 11, 1, 1, "#6a4a30"); }
  g.rect(x + 1, y + 15, 16, 2, chromeD); g.rect(x + 1, y + 15, 16, 1, "#a4a8aa");
  // steam: chunky blocks, more of them and bigger when the GPU is hot
  const st = "#ffffff";
  if (state === 1) {
    g.rect(x + 5 + (f ? 1 : 0), y - 4, 1, 3, st); g.rect(x + 11 - (f ? 1 : 0), y - 5, 1, 3, st);
  } else if (state === 2) {
    const r = f4;
    g.rect(x + 3 + (f ? 1 : 0), y - 4 - r, 2, 3, st); g.rect(x + 8 - (f ? 1 : 0), y - 6 - r, 2, 4, st); g.rect(x + 13 + (f ? 1 : 0), y - 4 - r, 2, 3, st);
    blob(g, x + 4 - (f ? 1 : 0), y - 10 - r, 4, 3, st); blob(g, x + 11 + (f ? 1 : 0), y - 9 - r, 3, 3, st);
  }
  // two mugs on the shelf
  for (const [mx, c] of [[x + 22, "#f2a0b8"], [x + 30, "#a8d8c0"]]) {
    g.rect(mx, shelfY - 5, 5, 5, c); g.rect(mx, shelfY - 5, 1, 5, mix(c, "#ffffff", 0.45)); g.rect(mx + 4, shelfY - 5, 1, 5, mix(c, "#5a2a40", 0.22));
    g.rect(mx + 5, shelfY - 4, 1, 3, c); g.rect(mx + 1, shelfY - 5, 3, 1, mix(c, "#5a2a40", 0.35));
  }
}

// ============================================================ LAYOUT
function spots(count, w) {
  // one equal-width band per cat, trees staggered on two floor lines so each family owns
  // its own band for bubbles and kittens
  const result = [];
  for (let i = 0; i < count; i++) {
    const cx = Math.round(w * (i + 0.5) / count);
    const baseY = count <= 2 ? 111 : (i % 2 === 0 ? 94 : 111);
    result.push({kind: "tree", cx, baseY, post: postFor(0)});
  }
  return result;
}

// the post grows with the number of working kittens (one level each), capped so the
// platform never crowds the wall
function postFor(kittens) { return Math.min(46, Math.max(21, LEVEL * (kittens - 1) + 13)); }

const CAT_H = 22, SLEEP_H = 11;
function catAnchors(spot, asleep) {
  const seat = treeGeometry(spot.cx, spot.baseY, spot.post).seatY;
  return {
    // a sleeping cat's head is at the left end of the loaf, so its bubble sits over there
    x: asleep ? spot.cx - 5 : spot.cx,
    bubbleY: seat - (asleep ? SLEEP_H : CAT_H) - 3,
    nameX: spot.cx, nameY: spot.baseY + 6,
    hover: {x0: spot.cx - 11, y0: seat - CAT_H - 1, x1: spot.cx + 11, y1: seat + 2},
  };
}

function kittenPlace(spot, index) {
  const slot = kittenSlot(spot.cx, spot.baseY, index);
  return {centerX: slot.cx, bottom: slot.bottom, side: slot.side};
}

function kittenHover(x, y) {
  return {x0: x - 6, y0: y - 11, x1: x + 6, y1: y + 1};
}

function kittenBubble(place) {
  // speech starts at the kitten's inner shoulder and runs across the trunk
  return {x: place.centerX - place.side * 7, y: place.bottom - 5};
}

// The wall props (window, pastry case, board, espresso machine) move together by half the
// extra width on a wide scene, so the group stays centred with its arrangement intact.
const wallShift = (w) => Math.round((w - W) / 2);
const WINDOW_X = 11, WINDOW_Y = 8, CASE_X = 70, CASE_Y = 7, BOARD_X = 128, BOARD_Y = 6,
  ESPRESSO_X = 240, ESPRESSO_Y = 13;

function boardText(w) {
  const x = BOARD_X + wallShift(w);
  return {x0: x + 4, y0: BOARD_Y + 4, x1: x + BOARD_W - 4, y1: BOARD_Y + BOARD_H - 4};
}

// ============================================================ THE SCENE'S PIECES
function drawBackdrop(g, w, frame, readings) {
  const shift = wallShift(w);
  const sun = windowState(readings.cpuLoad);
  drawRoom(g, w);
  drawWindow(g, WINDOW_X + shift, WINDOW_Y, sun, frame);
  drawCase(g, CASE_X + shift, CASE_Y,
    readings.docker.slice(0, 6).map((container) => ({busy: container.cpu >= 20})), frame);
  drawBoard(g, BOARD_X + shift, BOARD_Y);
  drawEspresso(g, ESPRESSO_X + shift, ESPRESSO_Y, espressoState(readings.gpu), frame);
  drawBunting(g, w);
  drawHangingPlant(g, 2);
  drawHangingPlant(g, w - 11);
  drawSunbeam(g, WINDOW_X + shift, sun);
  drawPlant(g, 5, WALL_H + 11);
  drawBowls(g, bowlsX(w), BOWL_Y);
  drawYarn(g, 94, 135, "#e66767");
  drawYarn(g, w - 83, 129, "#9085e9");
}

function drawSpotTree(g, spot, accent, frame, workingKittens) {
  drawTree(g, spot.cx, spot.baseY, spot.post, accent, frame, workingKittens);
}

// pose: what app.js has decided the cat is doing (see 8bit.js). The cat glances left, and
// when `turned` is drawn mirrored so it glances right.
function drawCat(g, spot, accent, pose, frame) {
  const seat = treeGeometry(spot.cx, spot.baseY, spot.post).seatY;
  const state = pose.status === "idle" ? "asleep" :
    pose.startled ? "startled" :
    pose.waiting ? "waiting" :
    pose.raisingHand ? "raising" :
    pose.status === "working" ? "working" : "thinking";
  drawCatAt(g, spot.cx, seat, accent, state, frame, {
    laptop: pose.laptop, blink: pose.blink, sip: pose.sipping, turned: pose.turned,
    pending: pose.pending, flash: pose.flash,
  });
}

// A working kitten sits at its place beside the trunk, batting a yarn ball.
function drawKittenWorking(g, place, accent, frame, index, yarnColor) {
  drawKittenWork(g, place.centerX, place.bottom, accent, frame + index, place.side, yarnColor);
}

// A finished kitten roams the floor after its ball: play = {x, y, ballX, ballY}, in art
// pixels but fractional, so both are rounded onto the grid. The kitten faces the ball, or,
// on an errand (play.errand, see attractions), the way it is walking, then does the errand.
function drawKittenPlaying(g, play, accent, frame, yarnColor) {
  const x = Math.round(play.x), y = Math.round(play.y);
  const ballX = Math.round(play.ballX), ballY = Math.round(play.ballY);
  drawMiniYarn(g, ballX - 2, ballY - 2, yarnColor, frame % 2);
  const errand = play.errand;
  if (!errand) { drawKittenPlay(g, x, y, accent, frame, ballX < x); return; }
  if (errand.phase !== "do") { drawKittenPlay(g, x, y, accent, frame, Math.round(errand.x) < x); return; }
  const flip = errand.facing < 0;
  if (errand.kind === "sun") drawKittenNapping(g, x, y, accent, frame);
  else if (errand.kind === "plant") drawKittenSwatting(g, x, y, accent, frame, flip);
  else {
    // the dish stands in front of it: whole while its head is up, just the front over its
    // muzzle when it dips in; a drop or a crumb hops out now and then
    drawKittenAtBowl(g, x, y, accent, frame, flip);
    const bowlX = x - 4, dipped = frame % 2 === 1;
    drawBowl(g, bowlX, BOWL_Y, errand.kind, dipped);
    if (frame % 4 === 1) g.rect(flip ? bowlX - 1 : bowlX + 10, BOWL_Y - 2, 1, 1, BOWLS[errand.kind][errand.kind === "water" ? 1 : 0]);
  }
}

// ------------------------------------------------------------ errands
// where kittens go: a bowl each to drink and eat at (sitting behind it, tails outward), the
// potted plant's right side to swat at it, and the warm patch of the sunbeam
const BOWL_Y = 136;
const bowlsX = (w) => w - 34;            // the water bowl's left edge; the food bowl is 12 on
function attractions(w, readings) {
  const list = [
    {kind: "water", x: bowlsX(w) + 4, y: BOWL_Y + 3, facing: -1},
    {kind: "food", x: bowlsX(w) + 16, y: BOWL_Y + 3, facing: 1},
    {kind: "plant", x: 20, y: WALL_H + 12, facing: -1},
  ];
  // the middle of the beam drawSunbeam lays on the floor (its rows run WALL_H + 4 to + 35)
  const x = WINDOW_X + wallShift(w);
  if (windowState(readings.cpuLoad) > 0) list.push({kind: "sun", area: {x0: x + 30, y0: WALL_H + 20, x1: x + 55, y1: WALL_H + 33}});
  return list;
}

// The man walks along the front of the floor; x moves 8 art pixels a frame.
function drawMan(g, x, frame, carrying, heading) {
  drawManAt(g, Math.round(x), H - 3, frame, carrying, heading < 0);
}

const art = {
  id: "16bit", px: PX, width: W, height: H,
  // kittens play on the floor below this line
  playTop: 54,
  spots, postFor, catAnchors, kittenPlace, kittenHover, kittenBubble, boardText, attractions,
  drawBackdrop, drawTree: drawSpotTree, drawCat, drawKittenWorking, drawKittenPlaying, drawMan,
};
root.NekomataArt = root.NekomataArt || {};
root.NekomataArt[art.id] = art;
if (typeof module === "object" && module.exports) module.exports = art;
})(typeof globalThis === "object" ? globalThis : this);
