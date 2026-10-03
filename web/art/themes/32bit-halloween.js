// Halloween for the 32bit cafe: a moonlit window with bats, orange and purple bunting,
// jack-o'-lanterns and spooky sweets in the case, a cobweb and a few pumpkins, and a witch
// hat on every cat.
(function (root) {
"use strict";
const art = root.NekomataArt["32bit"];
const {sprite, disc, mix, INK} = art.kit;

// a pen that only paints inside a rectangle (the window's glass)
function clipped(g, x0, y0, x1, y1) {
  return {rect(x, y, w, h, color) {
    const ax = Math.max(x, x0), ay = Math.max(y, y0);
    const bx = Math.min(x + w, x1), by = Math.min(y + h, y1);
    if (bx > ax && by > ay) g.rect(ax, ay, bx - ax, by - ay, color);
  }};
}

// ------------------------------------------------------------ the window: a moonlit night
// The moon stands in for the sun: a thin pale moon on a cool night, a full gold moon when
// warm, a huge orange harvest moon when hot.
const BAT_A = [
"O.....O",
"OO.O.OO",
".OOOOO.",
"...O...",
];
const BAT_B = [
"...O...",
".OOOOO.",
"OO.O.OO",
"O.....O",
];
const SKIES = [
  ["#232046", "#2e2a58", "#3e3670"],     // cool: deep night
  ["#2e2552", "#56407a", "#c27a6a"],     // warm: dusk, a glow on the horizon
  ["#3a1f45", "#7a3458", "#e8743a"],     // hot: a red sky under the harvest moon
];
function sky(g, x, y, w, h, state, frame) {
  const c = SKIES[state];
  g.rect(x, y, w, h, c[0]);
  g.rect(x, y + 11, w, h - 11, c[1]);
  g.rect(x, y + 18, w, h - 18, c[2]);
  const pen = clipped(g, x, y, x + w, y + h);
  // stars
  for (const [sx, sy] of [[6, 8], [22, 6], [35, 10], [44, 7], [51, 12], [17, 13]])
    if (state === 0 || sy < 10) g.rect(x + sx, y + sy, 1, 1, frame % 4 === sx % 4 ? "#fff6d0" : "#b8b0d8");
  // the moon
  const mx = x + 14, my = y + 13;
  if (state === 0) {
    disc(pen, mx, my, 5, "#f4ecc8");
    disc(pen, mx + 3, my - 1, 4, c[0]);                       // a crescent
  } else if (state === 1) {
    disc(pen, mx, my, 5, "#f7d98a"); disc(pen, mx, my, 4, "#fbe7a8");
    g.rect(mx - 2, my - 1, 2, 2, "#ecc670"); g.rect(mx + 1, my + 2, 1, 1, "#ecc670");
  } else {
    disc(pen, mx, my, 7, "#e8662a"); disc(pen, mx, my, 6, "#ff9a3c"); disc(pen, mx, my, 4, "#ffb85a");
    g.rect(mx - 3, my - 2, 2, 2, "#f08a3c"); g.rect(mx + 2, my + 1, 2, 1, "#f08a3c");
  }
  // two bats crossing the sky, wings beating
  for (let i = 0; i < 2; i++) {
    const bx = x + ((Math.floor(frame / 2) + i * 31) % (w + 14)) - 7;
    const by = y + 6 + i * 6 + ((frame + i) % 4 < 2 ? 0 : 1);
    sprite(pen, (frame + i) % 2 ? BAT_B : BAT_A, bx, by, {O: "#1a1224"});
  }
  // hills in silhouette, with a bare tree on the far one
  const far = mix(c[1], "#120c1c", 0.55), near = mix(c[1], "#120c1c", 0.78);
  const farH = [2, 3, 4, 5, 5, 6, 6, 6, 5, 5, 4, 3, 3, 2, 2, 2, 3, 4, 5, 6, 7, 7, 7, 6, 6, 5, 4, 3];
  for (let i = 0; i < w; i++) { const hh = farH[Math.floor(i / 2) % farH.length]; g.rect(x + i, y + h - 4 - hh, 1, hh + 4, far); }
  const tx = x + 44, ty = y + h - 11;
  g.rect(tx, ty, 1, 6, far); g.rect(tx - 2, ty + 1, 2, 1, far); g.rect(tx - 3, ty, 1, 1, far);
  g.rect(tx + 1, ty + 2, 2, 1, far); g.rect(tx + 3, ty + 1, 1, 1, far); g.rect(tx - 1, ty + 3, 1, 1, far);
  const nearH = [3, 3, 4, 4, 5, 5, 5, 4, 4, 3, 3, 2, 2, 2, 2, 3, 3, 4, 4, 4, 3, 3, 2, 2, 2, 3, 4, 5];
  for (let i = 0; i < w; i++) { const hh = nearH[Math.floor((i + 9) / 2) % nearH.length]; g.rect(x + i, y + h - hh, 1, hh, near); }
}

// ------------------------------------------------------------ bunting
const FLAG_COLORS = ["#f08a3c", "#8e6ad0"];
function bunting(g, w, frame) {
  const yAt = (x) => 2 + [0, 1, 1, 2, 2, 2, 2, 2, 1, 1, 0, 0][Math.floor(((x % 48) + 48) % 48 / 4)];
  for (let x = 0; x < w; x++) g.rect(x, yAt(x), 1, 1, "#4a3a4e");
  for (let i = 0, x = 8; x < w - 6; x += 16, i++) {
    const c = FLAG_COLORS[i % 2], y = yAt(x + 3) + 1;
    [7, 5, 5, 3, 1].forEach((rw, r) => {
      g.rect(x + (7 - rw) / 2, y + r, rw, 1, c);
      if (rw > 2) g.rect(x + (7 - rw) / 2 + rw - 1, y + r, 1, 1, mix(c, "#2a1430", 0.3));
    });
  }
  // a little bat hangs at every peg
  for (let x = 48; x < w - 4; x += 48) sprite(g, BAT_B, x - 3, 1, {O: "#2a1e36"});
}

// ------------------------------------------------------------ the pastry case
// o pumpkin  d ridge  G stem  E face (dark, or glowing when the container is busy)
const PUMPKIN = [
".....OGO....",
"..OOOOGOOO..",
".OodoooodoO.",
"OoEEooooEEoO",
"OooEooooEooO",
"OoEooooooEoO",
".OoEEEEEEoO.",
"..OOOOOOOO..",
];
const SWEETS = [
  { // a ghost meringue
    rows: [
".....OO.....",
"....OwwO....",
"...OwwwwO...",
"..OwKwwKwO..",
"..OwwwwwwO..",
".OwwwKKwwwO.",
".OwwwwwwwsO.",
"..OOOOOOOO..",
    ], pal: {w: "#fbf8f0", s: "#d8d2e0", K: "#2a1a20"}},
  { // candy corn
    rows: [
".....OO.....",
"....OwwO....",
"....OooO....",
"...OooooO...",
"...OyyyyO...",
"..OyyyyyyO..",
"..OyyyyyyO..",
"..OOOOOOOO..",
    ], pal: {w: "#fff6e0", o: "#f08a3c", y: "#f7d64a"}},
  { // a purple cupcake with a candy eyeball
    rows: [
"....OOOO....",
"...OpwKpO...",
"..OpppppbO..",
".OppppppbbO.",
".OOOOOOOOOO.",
"..OkqkqkqO..",
"..OkqkqkqO..",
"...OOOOOO...",
    ], pal: {p: "#a98ae0", b: "#7e62bc", w: "#ffffff", K: "#2a1a20", k: "#3a2e40", q: "#f08a3c"}},
  { // a witch-hat cookie
    rows: [
"......OO....",
".....OhdO...",
"....OhhdO...",
"...OhhhhdO..",
"...OoooooO..",
".OOhhhhhhdOO",
"OhhhhhhhhhdO",
".OOOOOOOOOO.",
    ], pal: {h: "#5a4a7a", d: "#3e3258", o: "#f08a3c"}},
];
// cakes 0 and 4 are jack-o'-lanterns, the rest sweets
function pastry(g, x, y, index, busy, frame) {
  const f = frame % 2;
  if (index % 4 === 0) {
    const face = busy ? (f ? "#ffd23e" : "#ffb83a") : "#5a2a18";
    sprite(g, PUMPKIN, x, y, {O: INK, o: "#f08a3c", d: "#c9652a", G: "#4e7a3a", E: face});
    return;
  }
  const s = SWEETS[(index - 1 - Math.floor(index / 4)) % SWEETS.length];
  sprite(g, s.rows, x, y, Object.assign({O: INK}, s.pal));
  if (busy) {
    // a black candle with an orange flame
    const cx = x + 9, top = y - 1;
    g.rect(cx, top - 1, 1, 3, "#3a2e40"); g.rect(cx, top, 1, 1, "#8e6ad0");
    g.rect(cx, top - 3, 1, 2, "#ff8a2e"); g.rect(cx, top - 3 - f, 1, 1, "#ffd23e");
  }
}

// ------------------------------------------------------------ decorations
const SPIDER = [".k.k.", "k.K.k", ".kKk.", "k.k.k"];
function cobweb(g, x, y) {
  // a web across the corner of the chalkboard: spokes and two sagging threads
  const web = "rgba(240,236,248,0.75)";
  for (let i = 0; i < 11; i++) { g.rect(x + i, y, 1, 1, web); g.rect(x, y + i, 1, 1, web); g.rect(x + i, y + i, 1, 1, web); }
  for (let i = 0; i < 8; i++) { g.rect(x + i, y + 4 + Math.floor(i / 3), 1, 1, web); g.rect(x + 4 + Math.floor(i / 3), y + i, 1, 1, web); }
  for (let i = 0; i < 6; i++) { g.rect(x + i, y + 8 - Math.floor(i / 3), 1, 1, web); g.rect(x + 8 - Math.floor(i / 3), y + i, 1, 1, web); }
}
const SMALL_PUMPKIN = [
"...OGO..",
".OOOGOO.",
"OoEodEoO",
"OoooodoO",
"OoEEEEoO",
".OOOOOO.",
];
function smallPumpkin(g, x, y, lit, frame) {
  const glow = lit ? (frame % 2 ? "#ffd23e" : "#ffb83a") : "#5a2a18";
  sprite(g, SMALL_PUMPKIN, x, y, {O: INK, o: "#f08a3c", d: "#c9652a", G: "#4e7a3a", E: glow});
}
function decor(g, w, frame, places) {
  const b = places.board;
  cobweb(g, b.x + 3, b.y + 3);
  // a spider lets itself down from the web, slowly, and climbs back
  const drop = [0, 1, 2, 3, 4, 4, 3, 2, 1, 0][Math.floor(frame / 3) % 10];
  g.rect(b.x + 9, b.y + 9, 1, drop + 2, "rgba(240,236,248,0.75)");
  sprite(g, SPIDER, b.x + 7, b.y + 11 + drop, {k: "#1a1224", K: "#3a2e40"});
  // a jack-o'-lantern on the window sill, and two by the bowls
  const win = places.window;
  smallPumpkin(g, win.x + win.w - 12, win.y + 25, true, frame);
  smallPumpkin(g, w - 12, 164, false, frame);
  smallPumpkin(g, w - 9, 170, true, frame + 1);
}

// ------------------------------------------------------------ the cats' witch hats
// H hat  h its lit side  d its shade  b band (the cat's colour)  k buckle
const WITCH_HAT = [
"..........OO..",
".........OhdO.",
"........OhdO..",
".......OhHdO..",
"......OhHHdO..",
".....OhHHHHdO.",
"....OhHHHHHdO.",
"...ObbbbkbbbO.",
"..OhHHHHHHHHdO",
];
// the brim rests on the top of the head with the ears poking up either side
const WITCH_BRIM = [
"OOOOOOOOOOOOOOOOOO",
"OhhHHHHHHHHHHHHddO",
".OOOOOOOOOOOOOOOO.",
];
function catOutfit(g, head, accent, frame) {
  const pal = {O: "#1e1428", H: "#4e3e6e", h: "#6e5a92", d: "#352a4e", b: accent, k: "#f2c94c"};
  sprite(g, WITCH_HAT, head.x + 4, head.y - 6, pal);
  sprite(g, WITCH_BRIM, head.x + 2, head.y + 3, pal);
}

art.registerTheme("halloween", {sky, bunting, pastry, decor, catOutfit});
})(typeof globalThis === "object" ? globalThis : this);
