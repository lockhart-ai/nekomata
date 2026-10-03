// Christmas for the 32bit cafe: a snowy window, a garland with fairy lights, a little tree
// by the wall, stockings under the espresso shelf, festive bakes in the case, gentle falling
// snow, and a Santa hat on every cat.
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

// ------------------------------------------------------------ the window: snowy hills
// The sun still shows the load: hazy behind snow clouds when cool, a clear winter sun when
// warm, a big low golden sun when hot.
const SKIES = [
  ["#b4c0d2", "#c6d0de", "#d6dee8"],
  ["#8ec4ea", "#b0d8f2", "#d8ecf8"],
  ["#e89a6a", "#f2b884", "#f8d8a8"],
];
const PINE = [
"..w..",
".OwO.",
".OgO.",
"OwggO",
"OgggO",
"OOkOO",
];
function sky(g, x, y, w, h, state, frame) {
  const c = SKIES[state];
  g.rect(x, y, w, h, c[0]);
  g.rect(x, y + 10, w, h - 10, c[1]);
  g.rect(x, y + 16, w, h - 16, c[2]);
  const pen = clipped(g, x, y, x + w, y + h);
  const sx = x + 13, sy = y + 13;
  if (state === 0) {
    disc(pen, sx, sy, 4, "#e6e8ea"); disc(pen, sx, sy, 3, "#f2f2ee");
  } else if (state === 1) {
    for (const [dx, dy, rw, rh] of [[-9, 0, 2, 1], [8, 0, 2, 1], [0, -9, 1, 2], [0, 8, 1, 2]])
      pen.rect(sx + dx, sy + dy, rw, rh, "#fbd75a");
    disc(pen, sx, sy, 5, "#f9c93a"); disc(pen, sx, sy, 4, "#fde27a");
  } else {
    disc(pen, sx, sy, 7, "#ff9a2e"); disc(pen, sx, sy, 6, "#ffc23a"); disc(pen, sx, sy, 4, "#ffe072");
  }
  // snowy hills, a shade of the sky in their hollows
  const far = mix(c[2], "#ffffff", 0.55), farD = mix(c[1], "#ffffff", 0.35);
  const farH = [2, 3, 4, 5, 5, 6, 6, 6, 5, 5, 4, 3, 3, 2, 2, 2, 3, 4, 5, 6, 7, 7, 7, 6, 6, 5, 4, 3];
  for (let i = 0; i < w; i++) {
    const hh = farH[Math.floor(i / 2) % farH.length];
    g.rect(x + i, y + h - 4 - hh, 1, hh + 4, far); g.rect(x + i, y + h - 4 - hh, 1, 1, farD);
  }
  // three little pines
  for (const [px, py] of [[33, 12], [39, 10], [6, 13]])
    sprite(pen, PINE, x + px, y + py, {O: "#24503a", g: "#2f6a48", w: "#ffffff", k: "#6b4a3a"});
  const nearH = [3, 3, 4, 4, 5, 5, 5, 4, 4, 3, 3, 2, 2, 2, 2, 3, 3, 4, 4, 4, 3, 3, 2, 2, 2, 3, 4, 5];
  for (let i = 0; i < w; i++) {
    const hh = nearH[Math.floor((i + 9) / 2) % nearH.length];
    g.rect(x + i, y + h - hh, 1, hh, "#ffffff"); g.rect(x + i, y + h - 1, 1, 1, mix(c[1], "#ffffff", 0.6));
  }
  // snow falling past the glass
  const flakes = state === 0 ? 10 : 5;
  for (let i = 0; i < flakes; i++) {
    const fx = x + Math.floor(hash(i, 11) * w) + ((Math.floor(frame / 3) + i) % 2);
    const fy = y + Math.floor(hash(i, 12) * h + frame * 0.5) % h;
    g.rect(fx, fy, 1, 1, "#ffffff");
  }
}

// the window's valance on its rod
function valanceWith(g, x, y, w, colors) {
  const edge = "#5a3a2c";
  g.rect(x - 2, y - 1, w + 4, 1, edge); g.rect(x - 3, y - 2, 2, 3, edge); g.rect(x + w + 1, y - 2, 2, 3, edge);
  for (let i = 0; i < w; i++) {
    const scallop = [4, 5, 5, 5, 4, 3][i % 6];
    for (let j = 0; j < scallop; j++)
      g.rect(x + i, y + j, 1, 1, j === 0 ? colors.top : j >= scallop - 1 ? colors.trim : colors.cloth);
    g.rect(x + i, y + scallop, 1, 1, "rgba(60,30,20,0.30)");
  }
}
// a red valance with a white fur trim and a sprig of holly in the middle
function valance(g, x, y, w, frame) {
  valanceWith(g, x, y, w, {top: "#f05a62", cloth: "#d9343f", trim: "#fffaf2"});
  const cx = x + Math.floor(w / 2);
  sprite(g, ["OO..OO", "OGOOGO", ".OrrO.", "..OO.."], cx - 3, y + 1, {O: "#1e3a2a", G: "#3e8f4a", r: "#ff5a5a"});
}

// ------------------------------------------------------------ garland and fairy lights
const LIGHTS = ["#ff5a5a", "#ffd23e", "#5ab8ff", "#7fe08a"];
function bunting(g, w, frame) {
  const yAt = (x) => 2 + [0, 1, 1, 2, 2, 3, 3, 2, 2, 1, 1, 0][Math.floor(((x % 48) + 48) % 48 / 4)];
  for (let x = 0; x < w; x++) {
    const y = yAt(x);
    g.rect(x, y, 1, 3, "#2f6a48");
    g.rect(x, y + (x % 3 === 0 ? 0 : 1), 1, 1, "#4f9a5a");          // needles catching the light
    if (x % 4 === 1) g.rect(x, y + 3, 1, 1, "#24503a");
  }
  // fairy lights along the garland, twinkling in turn
  for (let i = 0, x = 3; x < w; x += 8, i++) {
    const on = (i + Math.floor(frame / 2)) % 3 !== 0;
    g.rect(x, yAt(x) + 3, 1, 2, on ? LIGHTS[i % 4] : mix(LIGHTS[i % 4], "#3a2a2e", 0.55));
  }
  // a red bow at every peg
  for (let x = 0; x < w + 1; x += 48) {
    sprite(g, ["OO.OO", "ObOdO", ".OOO.", "Ob.dO"], x - 2, 1, {O: "#7a1e28", b: "#e0434f", d: "#b02a36"});
  }
}

// ------------------------------------------------------------ the pastry case
// g gingerbread, w icing, r red, G green, k dark, y gold, o orange, s shade
const BAKES = [
  { // a gingerbread man
    rows: [
"....OOOO....",
"...OgwgwO...",
".OOOOggOOOO.",
"OggwgggggwgO",
".OOOgrggOOO.",
"...OggrgO...",
"..OggOOggO..",
"..OOO..OOO..",
    ], pal: {g: "#c98a4a", w: "#fffaf2", r: "#e0434f"}},
  { // a Christmas pudding with holly
    rows: [
"....GrG.....",
"..OOOOOOOO..",
".OwwwwwwwwO.",
"OwwkwwwkwwwO",
"OkkkwkkkkkkO",
"OkkkkkkkkkkO",
".OkkkkkkkkO.",
"..OOOOOOOO..",
    ], pal: {w: "#fffaf2", k: "#6a3a24", G: "#3e8f4a", r: "#e0434f"}},
  { // a tree cookie with a star
    rows: [
".....yy.....",
".....OO.....",
"....OggO....",
"...OgrggO...",
"..OggggrgO..",
".OgrggggggO.",
"OOOOOkkOOOOO",
"....OkkO....",
    ], pal: {y: "#ffd23e", g: "#4f9a5a", r: "#e0434f", k: "#8a5a3c"}},
  { // a candy-cane cupcake
    rows: [
"....OOOO....",
"...OwrwrO...",
"..OrwrwrwO..",
".OwrwrwrwrO.",
".OOOOOOOOOO.",
"..OGGGGGGO..",
"..OGgGgGgO..",
"...OOOOOO...",
    ], pal: {w: "#fffaf2", r: "#e0434f", G: "#3e8f4a", g: "#6fbf5f"}},
  { // a snowman cake
    rows: [
"....OkkO....",
"...OkkkkO...",
"...OKwwKO...",
"...OwoowO...",
"..OwwwwwwO..",
".OwwwrwwwwO.",
".OwwwwwwwsO.",
"..OOOOOOOO..",
    ], pal: {k: "#3a2e40", K: "#2a1a20", w: "#fffaf2", o: "#f08a3c", r: "#e0434f", s: "#d6e2ee"}},
  { // a bauble biscuit
    rows: [
".....yy.....",
"....OyyO....",
"...OOOOOO...",
"..OrrhrrrO..",
".OrhrrrrrrO.",
".OrrrrrrrrO.",
"..OrrrrrdO..",
"...OOOOOO...",
    ], pal: {y: "#f2c94c", r: "#d9343f", h: "#ff8a90", d: "#a8242f"}},
];
function pastry(g, x, y, index, busy, frame) {
  const b = BAKES[index % BAKES.length];
  sprite(g, b.rows, x, y, Object.assign({O: INK}, b.pal));
  if (busy) {
    // a red and white candle, lit
    const f = frame % 2, cx = x + 10, top = y - 1;
    g.rect(cx, top - 1, 1, 3, "#fffaf2"); g.rect(cx, top, 1, 1, "#e0434f");
    g.rect(cx, top - 3, 1, 2, "#ff8a2e"); g.rect(cx, top - 3 - f, 1, 1, "#ffd23e");
  }
}

// ------------------------------------------------------------ decorations
const STOCKING = [
"OOOOO..",
"OwwwO..",
"OrrrO..",
"OrrrO..",
"OrrrO..",
"OrrrrO.",
"OrrrrrO",
".OOOOO.",
];
function decor(g, w, frame, places) {
  const win = places.window;
  // snow on the window sill
  g.rect(win.x - 1, win.y + 30, win.w + 2, 1, "#fbfdff");
  for (let i = 1; i < win.w - 3; i += 9) { g.rect(win.x + i, win.y + 29, 4, 1, "#fbfdff"); g.rect(win.x + i + 1, win.y + 28, 2, 1, "#fbfdff"); }
  g.rect(win.x - 1, win.y + 31, win.w + 2, 1, "#d6e2ee");
  // two stockings hung from the espresso shelf
  const e = places.espresso;
  sprite(g, STOCKING, e.x + 6, e.y + 31, {O: INK, w: "#fffaf2", r: "#d9343f"});
  sprite(g, STOCKING, e.x + 16, e.y + 31, {O: INK, w: "#fffaf2", r: "#3e8f4a"});
}

// ------------------------------------------------------------ the Christmas tree
// It stands in the front corner in place of the potted plant: three tiers of branches lit
// from the window side, tinsel, baubles, twinkling lights and a star, in a red pot, with
// presents piled round its foot. (x, y) is the pot's bottom-left.
const STAR = [
"...O...",
"..OyO..",
"OOOyOOO",
"OyyYyyO",
".OyyyO.",
"OyOOOyO",
"OO...OO",
];
const NEEDLES = {O: "#1e3a2a", l: "#62b05c", m: "#3e8f4a", d: "#2c6a46"};
const BAUBLES = [[-1, 4, "#e0434f"], [-5, 12, "#5ab8ff"], [4, 10, "#f2c94c"], [-8, 22, "#f2c94c"],
  [2, 19, "#e0434f"], [8, 24, "#b48ae0"], [-3, 28, "#f49ab0"], [-11, 31, "#e0434f"], [6, 31, "#5ab8ff"]];
const TWINKLES = [[2, 6], [-3, 9], [-2, 16], [6, 15], [-6, 19], [5, 21], [0, 25], [-7, 27], [10, 29], [-1, 32], [3, 28]];
function present(g, x, y, w, h, box, ribbon) {
  g.rect(x, y, w, h, INK);
  g.rect(x + 1, y + 1, w - 2, h - 2, box);
  g.rect(x + 1, y + 1, w - 2, 1, mix(box, "#ffffff", 0.35));
  g.rect(x + 1, y + h - 2, w - 2, 1, mix(box, "#2a1a20", 0.25));
  const mx = x + Math.floor(w / 2);
  g.rect(mx, y + 1, 1, h - 2, ribbon); g.rect(x + 1, y + 2, w - 2, 1, ribbon);
  // a bow on top
  g.rect(mx - 2, y - 2, 2, 2, ribbon); g.rect(mx + 1, y - 2, 2, 2, ribbon); g.rect(mx, y - 1, 1, 1, ribbon);
  g.rect(mx - 2, y - 3, 2, 1, INK); g.rect(mx + 1, y - 3, 2, 1, INK);
}
function plant(g, x, y, frame) {
  const cx = x + 11, top = y - 46;
  // a soft glow on the floor under it
  g.rect(cx - 16, y - 3, 34, 3, "rgba(255,214,120,0.12)");
  // branches: three tiers, the lowest drawn first so each tier's drooping edge hangs over the next
  for (const [ty, h, a, b] of [[top + 22, 13, 6, 13], [top + 14, 11, 4, 10], [top + 7, 10, 2, 7]]) {
    for (let r = 0; r < h; r++) {
      const hw = Math.round(a + (b - a) * r / (h - 1)), yy = ty + r;
      g.rect(cx - hw - 1, yy, hw * 2 + 3, 1, NEEDLES.O);
      for (let i = -hw; i <= hw; i++) {
        const c = i < -hw / 3 ? NEEDLES.l : i > hw / 3 ? NEEDLES.d : NEEDLES.m;
        g.rect(cx + i, yy, 1, 1, r === h - 1 && (i + hw) % 3 === 2 ? NEEDLES.O : c);
      }
    }
    g.rect(cx - b - 1, ty + h, b * 2 + 3, 1, "rgba(30,58,42,0.35)");
  }
  // a strand of tinsel looping down each tier
  for (const [ty, w0, w1] of [[top + 11, -5, 5], [top + 19, -8, 8], [top + 28, -11, 11]])
    for (let i = w0; i <= w1; i += 2) g.rect(cx + i, ty + Math.round((i - w0) / 4), 1, 1, "#f2d26a");
  // baubles, each with a glint
  for (const [dx, dy, c] of BAUBLES) {
    g.rect(cx + dx, top + dy, 2, 2, c); g.rect(cx + dx, top + dy, 1, 1, mix(c, "#ffffff", 0.6));
    g.rect(cx + dx + 1, top + dy + 1, 1, 1, mix(c, "#2a1a20", 0.3));
  }
  // fairy lights, twinkling in turn
  TWINKLES.forEach(([dx, dy], i) => {
    const on = (i + Math.floor(frame / 2)) % 3 !== 0;
    g.rect(cx + dx, top + dy, 1, 1, on ? LIGHTS[i % 4] : mix(LIGHTS[i % 4], "#1e3a2a", 0.55));
  });
  // the star, catching the light now and then
  sprite(g, STAR, cx - 3, top, {O: "#a8741e", y: "#ffd23e", Y: frame % 6 < 2 ? "#ffffff" : "#fff3a8"});
  // trunk and a red pot with a gold band
  g.rect(cx - 2, top + 35, 4, 3, "#6b4a3a");
  g.rect(cx - 6, top + 37, 12, 9, INK);
  g.rect(cx - 5, top + 38, 10, 7, "#d9343f"); g.rect(cx - 5, top + 38, 3, 7, "#f05a62");
  g.rect(cx + 2, top + 38, 3, 7, "#a8242f"); g.rect(cx - 5, top + 40, 10, 2, "#f2c94c");
  // presents piled round its foot
  present(g, x - 4, y - 9, 11, 9, "#e0434f", "#f2c94c");
  present(g, cx + 6, y - 7, 9, 7, "#5ab8ff", "#fffaf2");
  present(g, cx - 4, y - 5, 8, 5, "#4f9a5a", "#e0434f");
}

// ------------------------------------------------------------ the cats' Santa hats
// r red  l its lit side  d its shade  w fur  s fur shade
const SANTA_HAT = [
".....OOOO.........",
"....OlrrrOO.......",
"...OlrrrrrrOO.....",
"...OlrrrrrrrrdO...",
"..OlrrrrrrrrrrdO..",
"..OlrrrrrrrrrrrdO.",
];
const SANTA_BRIM = [
".OOOOOOOOOOOOOOOO.",
"OwwwwwwwwwwwwwwwsO",
"OwswwwwswwwwwswssO",
".OOOOOOOOOOOOOOOO.",
];
const POMPOM = [".OO.", "OwwO", "OwsO", ".OO."];
function catOutfit(g, head, accent, frame) {
  const pal = {O: "#3a1a20", r: "#d9343f", l: "#f05a62", d: "#a8242f", w: "#fffaf2", s: "#dcd4c8"};
  sprite(g, SANTA_HAT, head.x + 3, head.y - 4, pal);
  sprite(g, POMPOM, head.x + 17, head.y - 2, pal);              // the tip flops over to the side
  sprite(g, SANTA_BRIM, head.x + 2, head.y + 2, pal);
}

// ------------------------------------------------------------ gentle snow over the room
function front(g, w, h, frame) {
  const count = Math.floor(w / 10);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(hash(i, 1) * w) + (Math.floor((frame + i * 3) / 4) % 2);
    const y = Math.floor(hash(i, 2) * (h + 8) + frame * (0.5 + hash(i, 3) * 0.5)) % (h + 8) - 4;
    g.rect(x, y, 1, 1, "rgba(255,255,255,0.85)");
    if (i % 5 === 0) g.rect(x + 1, y, 1, 1, "rgba(255,255,255,0.5)");
  }
}

art.registerTheme("christmas", {sky, valance, bunting, pastry, decor, plant, catOutfit, front});
})(typeof globalThis === "object" ? globalThis : this);
