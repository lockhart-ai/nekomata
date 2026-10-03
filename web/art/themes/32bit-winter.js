// Winter for the 32bit cafe: the snowy weeks after the holidays. Deep snow and a snowman
// through a frosted window with icicles, a Fair Isle valance, paper snowflakes along the wall,
// warm things in the case, a wood stove in the corner, slow big flakes drifting past, and a
// bobble beanie on every cat.
(function (root) {
"use strict";
const art = root.NekomataArt["32bit"];
const {sprite, disc, mix, hash, INK} = art.kit;

// a pen that only paints inside a rectangle (the window's glass)
function clipped(g, x0, y0, x1, y1) {
  return {rect(x, y, w, h, color) {
    const ax = Math.max(x, x0), ay = Math.max(y, y0);
    const bx = Math.min(x + w, x1), by = Math.min(y + h, y1);
    if (bx > ax && by > ay) g.rect(ax, ay, bx - ax, by - ay, color);
  }};
}

// ------------------------------------------------------------ the window: deep snow
// The sun shows the load as ever: a hazy disc in a snow sky when cool, a pale clear sun
// when warm, a bright low sun in a rosy sky when hot.
const SKIES = [
  ["#bccada", "#ccd8e4", "#dbe4ec"],
  ["#9cc8ea", "#bcdcf2", "#e0eef8"],
  ["#c6b4d8", "#eab8b0", "#f6d8b8"],
];
// w snow  s snow shade  K coal  n carrot  b scarf  k twig
const SNOWMAN = [
"...OOO...",
"..OwwwO..",
"..OKwKO..",
"..OwnnO..",
".OObbbOO.",
"kOwwbwwOk",
".OwwKwsO.",
"OwwwwwwsO",
"OwwwKwwsO",
".OwwwwsO.",
];
function sky(g, x, y, w, h, state, frame) {
  const c = SKIES[state];
  g.rect(x, y, w, h, c[0]);
  g.rect(x, y + 10, w, h - 10, c[1]);
  g.rect(x, y + 16, w, h - 16, c[2]);
  const pen = clipped(g, x, y, x + w, y + h);
  const sx = x + 40, sy = y + 12;
  if (state === 0) {
    disc(pen, sx, sy, 4, "#e8ecef"); disc(pen, sx, sy, 3, "#f3f5f4");
  } else if (state === 1) {
    disc(pen, sx, sy, 5, "#f6e6a0"); disc(pen, sx, sy, 4, "#fdf3c8");
  } else {
    for (const [dx, dy, rw, rh] of [[-10, 0, 3, 1], [8, 0, 3, 1], [0, -10, 1, 3], [-7, -7, 1, 1], [7, -7, 1, 1]])
      pen.rect(sx + dx, sy + dy, rw, rh, "#ffd27a");
    disc(pen, sx, sy, 6, "#ffc46a"); disc(pen, sx, sy, 5, "#ffe08e");
  }
  // two bare birches on the far drift
  const bark = "#f2f0ea", mark = "#5a5058";
  for (const [tx, th] of [[10, 13], [17, 10]]) {
    pen.rect(x + tx, y + h - 6 - th, 1, th, bark);
    for (let i = 2; i < th; i += 3) pen.rect(x + tx, y + h - 6 - th + i, 1, 1, mark);
    pen.rect(x + tx - 2, y + h - 6 - th + 3, 2, 1, mark); pen.rect(x + tx + 1, y + h - 6 - th + 5, 2, 1, mark);
  }
  // deep drifts, and a snowman on the near one
  const shade = mix(c[1], "#ffffff", 0.3);
  const farH = [4, 5, 5, 6, 6, 7, 7, 7, 6, 6, 5, 5, 4, 4, 4, 5, 5, 6, 7, 8, 8, 8, 7, 7, 6, 5, 5, 4];
  for (let i = 0; i < w; i++) { const hh = farH[Math.floor(i / 2) % farH.length]; g.rect(x + i, y + h - 2 - hh, 1, hh + 2, "#f2f6fa"); g.rect(x + i, y + h - 2 - hh, 1, 1, shade); }
  sprite(pen, SNOWMAN, x + 33, y + h - 13, {O: "#5a6878", w: "#ffffff", s: "#d4e0ec", K: "#2a2a30", n: "#f08a3c", b: "#3a6ab0", k: "#6b4a3a"});
  const nearH = [5, 5, 6, 6, 6, 5, 5, 4, 4, 4, 5, 5, 6, 6, 6, 5, 4, 4, 3, 3, 4, 4, 5, 5, 6, 6, 5, 5];
  for (let i = 0; i < w; i++) { const hh = nearH[Math.floor((i + 5) / 2) % nearH.length]; if (i < 30 || i > 46) g.rect(x + i, y + h - hh, 1, hh, "#ffffff"); }
  // icicles hanging under the valance, and frost creeping in from the bottom corners
  [[3, 4], [7, 2], [12, 5], [18, 3], [23, 4], [31, 3], [36, 5], [42, 2], [47, 4], [52, 3]].forEach(([ix, len]) => {
    pen.rect(x + ix, y + 4, 2, len - 1, "#e8f4fc"); pen.rect(x + ix, y + 4 + len - 1, 1, 1, "#e8f4fc");
    pen.rect(x + ix + 1, y + 4, 1, len - 1, "#bcd8ec");
  });
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7 - i; j++) {
    if ((i + j) % 2 === 0 || j < 2 - i % 2) {
      pen.rect(x + i, y + h - 1 - j, 1, 1, "rgba(255,255,255,0.75)");
      pen.rect(x + w - 1 - i, y + h - 1 - j, 1, 1, "rgba(255,255,255,0.75)");
    }
  }
}

// a navy Fair Isle valance: a cream band of little diamonds along its middle
function valance(g, x, y, w, frame) {
  const edge = "#5a3a2c";
  g.rect(x - 2, y - 1, w + 4, 1, edge); g.rect(x - 3, y - 2, 2, 3, edge); g.rect(x + w + 1, y - 2, 2, 3, edge);
  for (let i = 0; i < w; i++) {
    const scallop = [4, 5, 5, 5, 4, 3][i % 6];
    for (let j = 0; j < scallop; j++) {
      const k = i % 4;
      const diamond = (j === 1 || j === 3) && k === 1 || j === 2 && (k === 0 || k === 2);
      g.rect(x + i, y + j, 1, 1, j >= scallop - 1 ? "#f2ead8" : j === 0 ? "#4a5e96" : diamond ? "#f2ead8" : "#2e3e6e");
    }
    g.rect(x + i, y + scallop, 1, 1, "rgba(60,30,20,0.30)");
  }
}

// ------------------------------------------------------------ paper snowflakes and pennants
const FLAKE = [
"...w...",
".w.w.w.",
"..www..",
"wwwbwww",
"..www..",
".w.w.w.",
"...w...",
];
function bunting(g, w, frame) {
  const yAt = (x) => 2 + [0, 1, 1, 2, 2, 2, 2, 2, 1, 1, 0, 0][Math.floor(((x % 48) + 48) % 48 / 4)];
  for (let x = 0; x < w; x++) g.rect(x, yAt(x), 1, 1, "#8a9aae");
  for (let i = 0, x = 8; x < w - 6; x += 16, i++) {
    const y = yAt(x + 3) + 1;
    if (i % 2 === 0) {
      // a paper snowflake turning a little on its thread
      g.rect(x + 3, y, 1, 1, "#8a9aae");
      sprite(g, FLAKE, x, y + 1, {w: "#ffffff", b: "#a9d4ee"}, (Math.floor(frame / 6) + i) % 4 === 0);
      g.rect(x, y + 4, 7, 1, "rgba(120,150,180,0.25)");
    } else {
      const c = i % 4 === 1 ? "#a9d4ee" : "#dceef8";
      [7, 5, 5, 3, 1].forEach((rw, r) => g.rect(x + (7 - rw) / 2, y + r, rw, 1, c));
    }
  }
}

// ------------------------------------------------------------ warm things in the case
// m mug  k cocoa  w white  c bun  b cinnamon  p pink  y gold  s shade  h shine
const WARM = [
  { // hot cocoa with marshmallows
    rows: [
"..OwwOwwO...",
".OkwwkwwkO..",
".OmmmmmmmOO.",
".OmmmmmmmO.O",
".OmmhmmmmO.O",
".OmmmmmmmOO.",
"..OmmmmmO...",
"..OOOOOOO...",
    ], pal: {w: "#fffaf2", k: "#7a4a30", m: "#5a8ad0", h: "#ffffff"}},
  { // a cinnamon bun
    rows: [
"............",
"..OOOOOOOO..",
".OccwwwwccO.",
"OcbbbcwccbcO",
"OcbcccbccbcO",
"OccbbbbbcccO",
".OcccccccsO.",
"..OOOOOOOO..",
    ], pal: {c: "#e8b06a", b: "#a86a3a", w: "#fff6e6", s: "#c98a4a"}},
  { // two mochi
    rows: [
"............",
"............",
"............",
".OOOO..OOOO.",
"OphppOOwhwwO",
"OppppOOwwwwO",
"OpppsOOwwwsO",
".OOOO..OOOO.",
    ], pal: {p: "#f6b8c8", w: "#fbf8f0", h: "#ffffff", s: "#d8c8c8"}},
  { // a steamed bun
    rows: [
"............",
"....OOOO....",
"..OOwwkwOO..",
".OwwwkwwwwO.",
"OwwwwwwwwwsO",
"OwwwwwwwwssO",
".OwwwwwwssO.",
"..OOOOOOOO..",
    ], pal: {w: "#fbf6ec", k: "#d8cbb8", s: "#e2d6c4"}},
  { // a bowl of soup
    rows: [
"............",
"............",
"............",
".OOOOOOOOOO.",
"OyyyhyyyyyyO",
"ObbbbbbbbbbO",
".ObbbbbbbsO.",
"..OOOOOOOO..",
    ], pal: {y: "#f0a050", h: "#fff2d8", b: "#6aa0d8", s: "#4a7ab8"}},
  { // a slice of honey cake
    rows: [
"............",
"........OOO.",
".....OOOyyO.",
"..OOOyyyyyO.",
"OOyyyyyyyyO.",
"OccccccccsO.",
"OyyyyyyyyyO.",
".OOOOOOOOO..",
    ], pal: {y: "#e8b04a", c: "#fff2d8", s: "#e8d6b0"}},
];
// a busy bake is piping hot: a curl of steam rises from it
function pastry(g, x, y, index, busy, frame) {
  const p = WARM[index % WARM.length];
  sprite(g, p.rows, x, y, Object.assign({O: INK}, p.pal));
  if (busy) {
    const f = frame % 2, steam = "#9fb4c8";
    for (const [dx, dy] of f ? [[4, -1], [5, -2], [5, -3], [4, -4], [8, -2], [7, -3]] : [[5, -1], [4, -2], [4, -3], [5, -4], [7, -2], [8, -3]])
      g.rect(x + dx, y + dy, 1, 1, steam);
  }
}

// ------------------------------------------------------------ decorations
// a striped scarf hung over the chalkboard's corner
function decor(g, w, frame, places) {
  const b = places.board;
  const sx = b.x + b.w - 8;
  for (let i = 0; i < 18; i++) {
    const stripe = Math.floor(i / 3) % 2 ? "#f2ead8" : "#3a6ab0";
    g.rect(sx, b.y - 1 + i, 4, 1, stripe); g.rect(sx - 1, b.y - 1 + i, 1, 1, INK); g.rect(sx + 4, b.y - 1 + i, 1, 1, INK);
  }
  g.rect(sx - 1, b.y - 2, 6, 1, INK); g.rect(sx - 4, b.y - 1, 4, 3, "#3a6ab0"); g.rect(sx - 4, b.y - 2, 4, 1, INK);
  for (let i = 0; i < 4; i++) g.rect(sx + i, b.y + 17, 1, 2 + (i % 2), "#f2ead8");       // fringe
  // snow along the window sill
  const win = places.window;
  g.rect(win.x - 1, win.y + 30, win.w + 2, 1, "#fbfdff");
  for (let i = 3; i < win.w - 3; i += 11) { g.rect(win.x + i, win.y + 29, 5, 1, "#fbfdff"); g.rect(win.x + i + 1, win.y + 28, 3, 1, "#fbfdff"); }
  g.rect(win.x - 1, win.y + 31, win.w + 2, 1, "#d6e2ee");
}

// ------------------------------------------------------------ the corner: a wood stove
// A little iron stove with a fire glowing in its window and a kettle on top, its pipe going
// up, and firewood stacked beside it (which kittens come to bat at). (x, y): bottom-left.
const KETTLE = [
"...OO....",
"..OOOO...",
".OkkkkO.O",
"OkhkkkkOk",
"OkkkkkkO.",
".OOOOOO..",
];
function plant(g, x, y, frame) {
  const iron = "#3c3c48", ironL = "#5a5a6a", ironD = "#2a2a34";
  const f = frame % 3;
  // the fire's warmth on the floor
  g.rect(x - 4, y - 3, 40, 3, "rgba(255,160,70,0.14)");
  const sx = x - 2, top = y - 18;
  // pipe
  g.rect(sx + 7, top - 26, 5, 27, INK); g.rect(sx + 8, top - 26, 3, 27, iron); g.rect(sx + 8, top - 26, 1, 27, ironL);
  g.rect(sx + 6, top - 27, 7, 2, INK); g.rect(sx + 7, top - 13, 5, 1, ironD);
  // body, top plate and legs
  g.rect(sx, top, 19, 16, INK);
  g.rect(sx + 1, top + 1, 17, 14, iron); g.rect(sx + 1, top + 1, 17, 1, ironL); g.rect(sx + 1, top + 1, 2, 14, ironL);
  g.rect(sx + 15, top + 2, 3, 13, ironD);
  g.rect(sx - 1, top - 1, 21, 2, INK); g.rect(sx, top - 1, 19, 1, "#6a6a7a");
  g.rect(sx + 1, y - 2, 3, 2, INK); g.rect(sx + 15, y - 2, 3, 2, INK);
  // the fire behind its little window, flickering
  g.rect(sx + 4, top + 4, 11, 8, INK);
  g.rect(sx + 5, top + 5, 9, 6, "#7a2e14");
  const flames = [[["#ff8a2e", 1, 3, 2], ["#ffd23e", 2, 2, 1], ["#ff8a2e", 5, 4, 2], ["#ffd23e", 6, 3, 1]],
                  [["#ff8a2e", 1, 4, 2], ["#ffd23e", 2, 3, 1], ["#ff8a2e", 5, 3, 2], ["#ffd23e", 5, 2, 1]],
                  [["#ff8a2e", 2, 3, 2], ["#ffd23e", 2, 2, 1], ["#ff8a2e", 5, 4, 3], ["#ffd23e", 6, 3, 1]]][f];
  for (const [c, dx, hgt, wd] of flames) g.rect(sx + 5 + dx, top + 11 - hgt, wd, hgt, c);
  g.rect(sx + 5, top + 10, 9, 1, "#ffb83a");
  g.rect(sx + 4, top + 13, 11, 1, ironD);                                   // ash lip
  // a blue kettle on top, steaming
  sprite(g, KETTLE, sx + 1, top - 7, {O: INK, k: "#5a8ad0", h: "#a9cdf2"});
  const st = Math.floor(frame / 2) % 2;
  g.rect(sx + 9 + st, top - 9, 1, 1, "rgba(240,244,250,0.9)"); g.rect(sx + 10 - st, top - 11, 1, 1, "rgba(240,244,250,0.7)");
  // firewood stacked end-on
  const LOG = [".OOO.", "OkrkO", "OrcrO", "OkrkO", ".OOO."];
  const logPal = {O: "#4a2e20", k: "#8a5a3c", r: "#c9925a", c: "#7a4a30"};
  for (const [lx, ly] of [[17, -5], [21, -5], [25, -5], [19, -9], [23, -9], [21, -13]])
    sprite(g, LOG, x + lx, y + ly, logPal);
}

// ------------------------------------------------------------ the cats' bobble beanies
// Each cat gets the yarn that stands out most from its fur. A startled cat's hat jumps.
const YARNS = ["#f2ead8", "#2e3e6e", "#e8b84a", "#d8e8f4", "#8a5aa8"];
const BEANIE = [
".......OOO.......",
"......OoooO......",
"......OoooO......",
".......OOO.......",
"....OOOOOOOOO....",
"..OOlhhhhhhhdOO..",
".OlhhkhhhkhhhhdO.",
".OhhhhhkhhhhkhdO.",
"OrRrRrRrRrRrRrRrO",
"ORrRrRrRrRrRrRrRO",
".OOOOOOOOOOOOOOO.",
];
function distance(a, b) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
function catOutfit(g, head, accent, frame) {
  const ranked = YARNS.slice().sort((a, b) => distance(b, accent) - distance(a, accent));
  const main = ranked[head.seed % 2];                     // one of the two that stand out most
  const trim = main === "#f2ead8" || main === "#d8e8f4" ? "#3a6ab0" : "#f2ead8";
  const pal = {O: mix(main, "#1e1a24", 0.7), h: main, l: mix(main, "#ffffff", 0.3), d: mix(main, "#1e1a24", 0.25),
    k: mix(main, "#1e1a24", 0.12), r: trim, R: mix(trim, "#1e1a24", 0.18), o: trim};
  const lift = head.startled ? 3 : 0;
  sprite(g, BEANIE, head.x + 3, head.y - 5 - lift, pal);
}

// ------------------------------------------------------------ big soft flakes, slowly
// Fewer and bigger than Christmas's, drifting down and a little to the left on the breeze.
function front(g, w, h, frame) {
  const count = Math.floor(w / 24);
  for (let i = 0; i < count; i++) {
    const fall = frame * (0.3 + hash(i, 3) * 0.2);
    const y = Math.floor(hash(i, 2) * (h + 10) + fall) % (h + 10) - 5;
    const x = ((Math.floor(hash(i, 1) * w - fall * 0.4) % w) + w) % w;
    g.rect(x, y, 1, 1, "rgba(255,255,255,0.9)");
    g.rect(x - 1, y, 1, 1, "rgba(255,255,255,0.45)"); g.rect(x + 1, y, 1, 1, "rgba(255,255,255,0.45)");
    g.rect(x, y - 1, 1, 1, "rgba(255,255,255,0.45)"); g.rect(x, y + 1, 1, 1, "rgba(255,255,255,0.45)");
  }
}

art.registerTheme("winter", {sky, valance, bunting, pastry, decor, plant, catOutfit, front});
})(typeof globalThis === "object" ? globalThis : this);
