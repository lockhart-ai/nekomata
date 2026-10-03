// Nekomata's 32bit cafe dressed for summer: the beach through the window, watermelon and
// lemon bunting, an ice-cream case under a striped awning, a desk fan on the sill, iced
// lemonade on the shelf, a beach towel for a rug, and sunglasses pushed up on every cat.
(function (root) {
"use strict";
const art = root.NekomataArt["32bit"];
const {sprite, disc, mix, INK} = art.kit;

const dot = (g, x, y, color) => g.rect(x, y, 1, 1, color);
// the wallpaper behind the wall props (see drawRoom), to paint a prop out
const wallAt = (x) => ((x - 6) % 24 + 24) % 24 < 12 ? "#f6e3c3" : "#f8e8cb";

// ------------------------------------------------------------ the window: the beach
const CLOUD = [
"....www.....",
"..wwwwwww...",
".wwwwwwwwww.",
"wwwwwwwwwwww",
".ssssssssss.",
];
const BOAT = [
"..w....",
"..ww...",
"..wwr..",
"..wwwr.",
"..y....",
"hhhhhhh",
".hhhhh.",
];
const PARASOL = [
"....OO....",
"..ORWRWO..",
".ORWRWRWO.",
"ORWRWRWRWO",
"OOOOpOOOOO",
"....p.....",
"....p.....",
"....p.....",
"....p.....",
];

// state: 0 cool (a soft morning), 1 warm (a bright noon), 2 hot (a blazing afternoon)
function sky(g, gx, gy, gw, gh, state, frame) {
  const f = frame % 2;
  const horizon = gy + 17, shore = gy + 21;
  // sky, lighter towards the sea
  const tones = [["#c4e6f2", "#d6eef6", "#e8f6fa"], ["#5fbfee", "#86d0f2", "#b4e3f6"],
    ["#f6c46a", "#f9d88a", "#fce9b0"]][state];
  g.rect(gx, gy, gw, horizon - gy, tones[0]);
  g.rect(gx, gy + 9, gw, horizon - gy - 9, tones[1]);
  g.rect(gx, gy + 14, gw, horizon - gy - 14, tones[2]);
  // the sun, high over the sea
  const sx = gx + 13, sy = gy + 10;
  if (state === 0) {
    disc(g, sx, sy, 4, "#fbf1c4"); disc(g, sx, sy, 3, "#fff8dc");
    sprite(g, CLOUD, gx + 9, gy + 10, {w: "#ffffff", s: "#d4e6ef"});
    sprite(g, CLOUD, gx + 38, gy + 6, {w: "#ffffff", s: "#d4e6ef"});
  } else if (state === 1) {
    const ray = "#ffd84a";
    for (const [dx, dy, w, h] of [[-9, 0, 2, 1], [8, 0, 2, 1], [0, -9, 1, 2], [0, 8, 1, 2],
      [-7, -7, 1, 1], [6, -7, 1, 1], [-7, 6, 1, 1], [6, 6, 1, 1]])
      g.rect(sx + dx, sy + dy, w, h, ray);
    disc(g, sx, sy, 5, "#fbc93a"); disc(g, sx, sy, 4, "#ffe27a"); disc(g, sx - 1, sy - 1, 3, "#fff2b0");
  } else {
    // blazing: a big white-hot sun with long rays that pulse
    const ray = f ? "#ff8a2e" : "#ffa640", L = f ? 4 : 3;
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      g.rect(sx + (ux > 0 ? 9 : ux < 0 ? -9 - L : -1), sy + (uy > 0 ? 9 : uy < 0 ? -9 - L : -1),
        ux ? L + 1 : 2, uy > 0 ? 2 : uy ? L + 1 : 2, ray);
    for (const [dx, dy] of [[-8, -8], [7, -8], [-8, 7], [7, 7]]) g.rect(sx + dx, sy + dy, 2, 2, ray);
    disc(g, sx, sy, 7, "#ff9a2e"); disc(g, sx, sy, 6, "#ffc23a"); disc(g, sx, sy, 4, "#ffe680"); disc(g, sx - 1, sy - 1, 3, "#fff8d8");
  }
  // the sea, with a glitter that moves
  const sea = [["#86c9d6", "#a6d9e0"], ["#2f8fd0", "#4aaee0"], ["#3a92bc", "#5aaccc"]][state];
  g.rect(gx, horizon, gw, shore - horizon, sea[1]);
  g.rect(gx, horizon, gw, 1, sea[0]);
  const glint = ["#e8f6f8", "#ffffff", "#ffe08a"][state];
  for (let i = 0; i < 7; i++) {
    const x = gx + ((i * 9 + Math.floor(frame / 2) * (i % 2 ? 1 : -1)) % gw + gw) % gw;
    g.rect(Math.min(x, gx + gw - 2), horizon + 1 + (i % 3), 2, 1, glint);
  }
  // a little sailboat drifting along the horizon
  const bx = gx + ((Math.floor(frame / 6) + 30) % (gw + 10)) - 8;
  const boat = {w: "#ffffff", r: "#f07a8a", y: "#8a5a3c", h: "#e05a4a"};
  for (let r = 0; r < BOAT.length; r++)
    for (let c = 0; c < BOAT[r].length; c++) {
      const k = BOAT[r][c], x = bx + c;
      if (k !== "." && x >= gx && x < gx + gw) dot(g, x, horizon - 5 + r, boat[k]);
    }
  // the shore: foam, then sand
  g.rect(gx, shore, gw, gy + gh - shore, "#f6dfa4");
  g.rect(gx, shore + 3, gw, gy + gh - shore - 3, "#efd090");
  for (let i = 0; i < gw; i++) if ((i + Math.floor(frame / 3)) % 7 < 4) dot(g, gx + i, shore, "#ffffff");
  for (let i = 0; i < gw; i += 6) dot(g, gx + i + 2, shore + 2 + (i % 12 ? 0 : 2), "#e2bf7c");
  // a striped parasol on the sand
  sprite(g, PARASOL, gx + 31, shore - 6, {O: "#9a3a3a", R: "#f0645a", W: "#fff6ea", p: "#8a5a3c"});
  // the heat shimmering over the sand
  if (state === 2)
    for (let i = 0; i < 4; i++) {
      const x = gx + 3 + i * 14, y = shore - 2 - (i % 2);
      for (let j = 0; j < 5; j++) dot(g, x + j, y + ((j + f) % 2), "rgba(255,255,255,0.55)");
    }
}

// ------------------------------------------------------------ bunting: watermelon and lemon
function bunting(g, w) {
  const yAt = (x) => 2 + [0, 1, 1, 2, 2, 2, 2, 2, 1, 1, 0, 0][Math.floor(((x % 48) + 48) % 48 / 4)];
  for (let x = 0; x < w; x++) dot(g, x, yAt(x), "#9a7458");
  for (let i = 0, x = 8; x < w - 6; x += 16, i++) {
    const y = yAt(x + 3) + 1;
    if (i % 2 === 0) {
      // a watermelon slice, hung by its cut edge
      g.rect(x - 1, y, 9, 2, "#f2647a"); g.rect(x, y + 2, 7, 1, "#f2647a");
      g.rect(x - 1, y, 9, 1, "#ff8a9a");
      g.rect(x, y + 3, 7, 1, "#bfe39a"); g.rect(x + 1, y + 4, 5, 1, "#3f8f40");
      dot(g, x + 1, y + 1, INK); dot(g, x + 3, y + 2, INK); dot(g, x + 5, y + 1, INK);
    } else {
      // a lemon slice
      const r = "#f2c230", p = "#fff3a0", c = "#fffbe0";
      g.rect(x + 2, y, 3, 1, r); g.rect(x + 1, y + 1, 5, 1, r); g.rect(x, y + 2, 7, 2, r);
      g.rect(x + 1, y + 4, 5, 1, r); g.rect(x + 2, y + 5, 3, 1, r);
      g.rect(x + 2, y + 1, 3, 1, p); g.rect(x + 1, y + 2, 5, 2, p); g.rect(x + 2, y + 4, 3, 1, p);
      dot(g, x + 3, y + 1, c); dot(g, x + 3, y + 4, c); g.rect(x + 1, y + 2, 1, 2, c); g.rect(x + 5, y + 2, 1, 2, c);
      dot(g, x + 3, y + 2, c); dot(g, x + 3, y + 3, c);
    }
  }
}

// ------------------------------------------------------------ the ice-cream case
// a: main  b: shade  h: shine  w: cream  k: chips/seeds  y: cone/stick  q: cone shade
// r: cherry  g: glass  G: glass shade.  `tip` is where a busy treat's sparkler goes in.
const TREATS = [
  { // strawberry cone
    rows: [
"....OOOO....",
"...OahaaO...",
"..OahaaabO..",
"..OaaaabbO..",
"...OyqyqO...",
"....OqyO....",
"....OyqO....",
".....OO.....",
    ], pal: {a: "#f7a0b8", b: "#e0789a", h: "#ffd6e2", y: "#e8b06a", q: "#c88a48"}, tip: [8, 0]},
  { // mint choc-chip in a striped cup
    rows: [
"...OOOOOO...",
"..OahakaaO..",
".OakaaaakbO.",
".OaaakaabbO.",
"OwwwwwwwwwwO",
".OwrwwrwwrO.",
"..OrwwrwwO..",
"...OOOOOO...",
    ], pal: {a: "#a8e6c4", b: "#78c8a0", h: "#e0fff0", k: "#6a4030", w: "#fffaf2", r: "#7ab8f0"}, tip: [7, 0]},
  { // orange and lemon ice lolly
    rows: [
"....OOOO....",
"...OaahaO...",
"...OaaaaO...",
"...OwwhwO...",
"...OwwwbO...",
"....OOOO....",
".....OyO....",
".....OO.....",
    ], pal: {a: "#ff9a4a", b: "#e8c030", h: "#fff2c0", w: "#ffe060", y: "#e8c48c"}, tip: [6, 0]},
  { // vanilla soft-serve with sprinkles
    rows: [
".....OO.....",
"....OwhO....",
"...OwrwwO...",
"..OcwwwkcO..",
"..OyqyqyqO..",
"...OqyqyO...",
"....OyqO....",
".....OO.....",
    ], pal: {w: "#fff6e4", h: "#ffffff", c: "#ead8b8", r: "#f2647a", k: "#5fb8e8", y: "#e8b06a", q: "#c88a48"}, tip: [7, 1]},
  { // watermelon slice
    rows: [
"............",
"............",
"OOOOOOOOOOOO",
"OaakaaahakaO",
".OaaakaakaO.",
".OwwwwwwwwO.",
"..OggggggO..",
"...OOOOOO...",
    ], pal: {a: "#f2647a", h: "#ff9aa8", k: "#3a2a2e", w: "#e8f6d0", g: "#4f9f4a"}, tip: [3, 2]},
  { // a snow cone: cherry over blue raspberry, in a paper cup
    rows: [
"....OOOO....",
"...OahaaO...",
"..OaaaaabO..",
"..OcchcddO..",
"...OwwwvO...",
"...OwwwvO...",
"....OwvO....",
".....OO.....",
    ], pal: {a: "#f2647a", b: "#d04a60", h: "#ffb0bc", c: "#6cb8f0", d: "#4a90d0", w: "#fffaf2", v: "#e3d2bc"}, tip: [8, 0]},
];
// busy: a sparkler stuck in the treat, fizzing
const SPARKS = [
  [[1, -2, "w"], [-2, -1, "y"], [2, 0, "y"], [-1, -3, "o"], [-2, 1, "o"], [3, -2, "o"]],
  [[-1, -2, "w"], [2, -2, "y"], [-2, 1, "y"], [1, -3, "o"], [3, 0, "o"], [-3, -1, "o"]],
  [[2, -1, "w"], [0, -3, "y"], [-2, -2, "y"], [2, 1, "o"], [-3, 0, "o"], [-1, 1, "o"]],
];
function pastry(g, x, y, index, busy, frame) {
  const t = TREATS[index % TREATS.length];
  sprite(g, t.rows, x, y, Object.assign({O: INK}, t.pal));
  if (!busy) return;
  const sx = x + t.tip[0], top = y + t.tip[1] - 2;
  g.rect(sx, top, 1, 2, "#9aa0aa");
  const c = {w: "#ffffff", y: "#ffe04a", o: "#ff9a3a"};
  g.rect(sx - 1, top - 1, 3, 1, "#fff2a0"); g.rect(sx, top - 2, 1, 3, "#fff2a0"); dot(g, sx, top - 1, "#ffffff");
  for (const [dx, dy, k] of SPARKS[frame % 3]) dot(g, sx + dx, top - 1 + dy, c[k]);
}

// ------------------------------------------------------------ decorations
const FAN_STAND = [
"....OpO....",
"....OpO....",
"..OOpppOO..",
".OppppppqO.",
".OOOOOOOOO.",
];
const FAN_PAL = {O: INK, c: "#e4f6f2", B: "#4fb0a2", H: "#f7d64a", p: "#7fd0c0", q: "#4fa898"};

const LEMONADE = [
"....s..",
"....s..",
"OOOOsOO",
"OgggsgO",
"OaaasaO",
"OkkasaO",
"OkkhaaO",
"OaahaaO",
"OaaaaaO",
"OaaaaaO",
".OOOOO.",
];

// the fan's round guard with four blades, a quarter turn apart, turned 45 degrees a frame
function drawFanHead(g, cx, cy, f) {
  disc(g, cx, cy, 5, INK); disc(g, cx, cy, 4, "#e4f6f2");
  for (let b = 0; b < 4; b++) {
    const a = (b + f / 2) * Math.PI / 2;
    for (let t = 1; t <= 3.5; t += 0.5) {
      const ox = cx - 0.5 + t * Math.cos(a), oy = cy - 0.5 + t * Math.sin(a);
      dot(g, Math.round(ox), Math.round(oy), "#4fb0a2");
      if (t >= 2) dot(g, Math.round(cx - 0.5 + t * Math.cos(a + 0.45)), Math.round(cy - 0.5 + t * Math.sin(a + 0.45)), "#7fcfc0");
    }
  }
  g.rect(cx - 1, cy - 1, 2, 2, "#f7d64a");
}

function decor(g, w, frame, places) {
  const f = Math.floor(frame / 1) % 2;
  // a desk fan on the windowsill, humming, its ribbon streaming
  const win = places.window;
  const fx = win.x + win.w - 16, fy = win.y + 31 - 15;
  sprite(g, FAN_STAND, fx, fy + 10, FAN_PAL);
  drawFanHead(g, fx + 6, fy + 5, f);

  // iced lemonade in place of the two mugs on the espresso shelf
  const ex = places.espresso.x, shelfY = places.espresso.y + 27;
  for (let x = ex + 31; x < ex + 52; x++) g.rect(x, shelfY - 7, 1, 7, wallAt(x));
  for (const [dx, color] of [[33, "#f9e27a"], [43, "#f7a0b8"]]) {
    const pal = {O: INK, a: color, h: mix(color, "#ffffff", 0.45), g: "#eaf6f8", k: "#f4fbff", s: "#f0645a"};
    sprite(g, LEMONADE, ex + dx, shelfY - LEMONADE.length, pal);
    // a lemon wheel on the rim
    g.rect(ex + dx - 1, shelfY - 10, 3, 3, "#f2c230"); dot(g, ex + dx, shelfY - 9, "#fff3a0");
  }

  // a striped awning over the ice-cream case
  const pc = places.pastryCase;
  g.rect(pc.x - 2, pc.y - 3, pc.w + 4, 2, INK);
  for (let i = 0; i < pc.w + 2; i++) {
    const x = pc.x - 1 + i, stripe = Math.floor(i / 6) % 2;
    const deep = [4, 5, 5, 5, 5, 4][i % 6];
    g.rect(x, pc.y - 2, 1, deep, stripe ? "#fff6ea" : "#f28aa0");
    if (i % 6 === 0 || i % 6 === 5) dot(g, x, pc.y - 2 + deep, INK);
    else dot(g, x, pc.y - 2 + deep, INK);
  }
  g.rect(pc.x - 1, pc.y - 2, pc.w + 2, 1, "rgba(255,255,255,0.45)");
  g.rect(pc.x - 2, pc.y - 2, 1, 4, INK); g.rect(pc.x + pc.w + 1, pc.y - 2, 1, 4, INK);

  // a beach towel spread where the rug lies: teal, striped at the ends, fringed
  const rug = places.rug;
  const ENDS = "tttttcssccyyycc";
  const tone = {t: "#62bcc8", c: "#fff4e0", s: "#f2857a", y: "#f7d470"};
  g.rect(rug.x, rug.y - 1, rug.w, rug.h + 2, "#3f7f88");
  for (let i = 0; i < rug.w; i++) {
    const k = ENDS[Math.min(i, rug.w - 1 - i)] || "t", c = tone[k];
    g.rect(rug.x + i, rug.y, 1, rug.h, c);
    dot(g, rug.x + i, rug.y, mix(c, "#ffffff", 0.35));
    dot(g, rug.x + i, rug.y + rug.h - 1, mix(c, "#2a4a50", 0.15));
  }
  for (let j = 0; j < rug.h; j += 2) {
    g.rect(rug.x - 2, rug.y + j, 2, 1, "#fff4e0"); g.rect(rug.x + rug.w, rug.y + j, 2, 1, "#fff4e0");
  }
}

// ------------------------------------------------------------ the window's valance and light
// a cabana-striped valance, on the rod as usual (the style draws the sill)
function valance(g, x, y, w) {
  const edge = "#5a3a2c";
  g.rect(x - 2, y - 1, w + 4, 1, edge); g.rect(x - 3, y - 2, 2, 3, edge); g.rect(x + w + 1, y - 2, 2, 3, edge);
  for (let i = 0; i < w; i++) {
    const deep = [4, 5, 5, 5, 4, 3][i % 6], stripe = Math.floor((i + 2) / 4) % 2;
    const c = stripe ? "#fffaf2" : "#5fbfd0", cD = stripe ? "#e8eef0" : "#3fa0b8";
    g.rect(x + i, y, 1, deep, c);
    dot(g, x + i, y, stripe ? "#ffffff" : "#8ad6e2"); dot(g, x + i, y + deep - 1, cD);
    dot(g, x + i, y + deep, "rgba(60,30,20,0.30)");
  }
}
// a strong summer beam across the floor
function sunbeam(g, x, state) {
  const color = ["rgba(240,250,255,0.10)", "rgba(255,244,190,0.20)", "rgba(255,214,130,0.27)"][state];
  for (let y = 67; y < 174; y++) g.rect(x + 12 + Math.floor((y - 67) * 0.75), y, 64, 1, color);
}

// ------------------------------------------------------------ the cats' sunglasses
// pushed up on the head, between the ears: dark lenses with a glint, a bright frame
const SHADES = [
"FFFFFF....FFFFFF",
"FGwGGFFFFFFGwGGF",
"FgGGgF....FgGGgF",
".FFFF......FFFF.",
];
function catOutfit(g, head, accent) {
  sprite(g, SHADES, head.x + (head.asleep ? 3 : 2), head.y + 2,
    {F: "#221a24", G: "#38406e", g: "#6878b8", w: "#ffffff"});
}

art.registerTheme("summer", {sky, bunting, pastry, decor, valance, sunbeam, catOutfit});
})(typeof globalThis === "object" ? globalThis : this);
