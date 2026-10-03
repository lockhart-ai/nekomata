// Spring, for the 32bit cafe: a cherry branch over a meadow in the window under a mint
// valance, a garland of blossoms along the wall, pastel cakes, tulips on the sill, a big pot
// of flowers and a jug of cherry branches on the floor, blossoms in the rug, a big flower on
// every cat's head and a few petals drifting slowly across the room. See the hooks in
// web/art/32bit.js ("themes").
(function (root) {
"use strict";
const art = root.NekomataArt["32bit"];
const {sprite, disc, mix, hash, catPalette, INK} = art.kit;

// blossom pinks, a pale highlight, a deep pink for buds, a soft yellow for the centres
const PINK = "#f7b3c6", PINK_L = "#ffe2ea", PINK_D = "#e5859f", CENTRE = "#f6d36b";
const LEAF = "#6fbf5f", LEAF_D = "#3e8f4a", BARK = "#6e4a3c", BARK_L = "#8f6450";

// the style's hash, spread over the whole of 0..1 (for small inputs it stays low)
const pick = (a, b) => (hash(a, b) * 97) % 1;

// a five-petal blossom around (x, y): petals in a plus, one lit, one shaded
function bloom(g, x, y, petal, light, shade, centre) {
  g.rect(x - 1, y, 3, 1, petal); g.rect(x, y - 1, 1, 3, petal);
  g.rect(x - 1, y - 1, 1, 1, light); g.rect(x + 1, y + 1, 1, 1, shade);
  g.rect(x, y, 1, 1, centre);
}

// ------------------------------------------------------------ the view
const CLOUD = ["..www...", ".wwwwww.", "wwwwwwww", ".ssssss."];
const SKIES = [["#c4e4f4", "#d6edf8", "#e9f6f6"], ["#96d3f2", "#b8e2f6", "#fbf0cc"], ["#f7b98a", "#f9cd98", "#fde3b4"]];
// the cherry branch reaching in from the top right of the glass (b bark, B bark lit)
const BRANCH = [
"....................BB",
"..................BBbb",
"..........b.....BBbb..",
"...........b..BBbb....",
"............bbbb......",
"..........bbb.........",
"........bb............",
"......bb..b...........",
"....bb.....b..........",
"..bb..................",
];
const BRANCH_BLOOMS = [[2, 9], [6, 6], [10, 2], [12, 8], [15, 5], [19, 3], [9, 4]];
const BRANCH_BUDS = [[0, 9], [4, 7], [8, 1], [13, 2], [17, 6], [21, 4], [11, 9]];

function sky(g, gx, gy, gw, gh, state, frame) {
  const f = frame % 2;
  const s = SKIES[state];
  g.rect(gx, gy, gw, gh, s[0]); g.rect(gx, gy + 10, gw, gh - 10, s[1]); g.rect(gx, gy + 16, gw, gh - 16, s[2]);
  // the sun, as the everyday window has it, so the load still reads
  const sx = gx + 13, sy = gy + 13;
  if (state === 0) {
    disc(g, sx, sy, 4, "#fbf3c8"); disc(g, sx, sy, 3, "#fff9de");
    sprite(g, CLOUD, gx + 9, gy + 13, {w: "#ffffff", s: "#d2e3ee"});
  } else if (state === 1) {
    const ray = "#fbd75a";
    for (const [dx, dy, w, h] of [[-9, 0, 2, 1], [8, 0, 2, 1], [0, -9, 1, 2], [0, 8, 1, 2]]) g.rect(sx + dx, sy + dy, w, h, ray);
    disc(g, sx, sy, 5, "#f9c93a"); disc(g, sx, sy, 4, "#fde27a");
  } else {
    const ray = "#ff8a2e", L = f ? 4 : 3;
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      g.rect(sx + (ux > 0 ? 9 : ux < 0 ? -9 - L : -1), sy + (uy > 0 ? 9 : uy < 0 ? -9 - L : -1), ux ? L + 1 : 2, uy > 0 ? 3 : uy ? L + 1 : 2, ray);
    disc(g, sx, sy, 7, "#ff9a2e"); disc(g, sx, sy, 6, "#ffc23a"); disc(g, sx, sy, 4, "#ffe072");
  }
  // fresh green hills, flowers in the near grass
  const far = ["#b3dcb0", "#a6dc9a", "#c9d98a"][state], near = ["#88c97a", "#78c766", "#9cc25a"][state];
  const farH = [2, 3, 4, 5, 5, 6, 6, 6, 5, 5, 4, 3, 3, 2, 2, 2, 3, 4, 5, 6, 7, 7, 7, 6, 6, 5, 4, 3];
  const farTop = (i) => gy + gh - 4 - farH[Math.floor(i / 2) % farH.length];
  for (let i = 0; i < gw; i++) g.rect(gx + i, farTop(i), 1, gh - (farTop(i) - gy), far);
  const nearH = [3, 3, 4, 4, 5, 5, 5, 4, 4, 3, 3, 2, 2, 2, 2, 3, 3, 4, 4, 4, 3, 3, 2, 2, 2, 3, 4, 5];
  for (let i = 0; i < gw; i++) { const hh = nearH[Math.floor((i + 9) / 2) % nearH.length]; g.rect(gx + i, gy + gh - hh, 1, hh, near); }
  // a meadow of little flowers in the near grass
  const MEADOW = ["#fff6e0", CENTRE, PINK, "#d4bdf0"];
  for (let i = 0; i < gw; i += 2) {
    const hh = nearH[Math.floor((i + 9) / 2) % nearH.length];
    if (pick(i, 3) < 0.6) g.rect(gx + i + (pick(i, 4) < 0.5 ? 1 : 0), gy + gh - 1 - Math.floor(pick(i, 5) * (hh - 1)), 1, 1, MEADOW[Math.floor(pick(i, 6) * 4)]);
  }
  // a cherry branch in from the top right
  const bx = gx + gw - 22, by = gy + 2;
  sprite(g, BRANCH, bx, by, {b: BARK, B: BARK_L});
  for (const [dx, dy] of BRANCH_BUDS) g.rect(bx + dx, by + dy, 1, 1, PINK_D);
  for (const [dx, dy] of BRANCH_BLOOMS) bloom(g, bx + dx, by + dy, PINK, PINK_L, PINK_D, "#fff4c0");
}

// ------------------------------------------------------------ the garland
// a blossom garland on a green vine, in the everyday bunting's drape
const GARLAND_FLOWER = [
"..a..",
"aabaa",
".bcb.",
"aa.aa",
];
const GARLAND_COLORS = [
  {a: "#f4a3ba", b: "#ffe2ea", c: "#f6d36b"},
  {a: "#f6d36b", b: "#fff4c0", c: "#e89a3c"},
  {a: "#f4a3ba", b: "#ffe2ea", c: "#f6d36b"},
  {a: "#c8a8ec", b: "#efe4ff", c: "#f6d36b"},
];
function bunting(g, w, frame) {
  const yAt = (x) => 2 + [0, 1, 1, 2, 2, 2, 2, 2, 1, 1, 0, 0][Math.floor(((x % 48) + 48) % 48 / 4)];
  for (let x = 0; x < w; x++) g.rect(x, yAt(x), 1, 1, "#5f9a4a");
  // a pair of leaves between each two flowers
  for (let x = 2; x < w; x += 12) {
    const y = yAt(x);
    g.rect(x, y + 1, 2, 1, LEAF); g.rect(x + 1, y + 2, 1, 1, LEAF_D);
    g.rect(x + 12, yAt(x + 12) - 1, 2, 1, LEAF);
  }
  for (let i = 0, x = 6; x < w - 4; x += 12, i++) {
    const pal = GARLAND_COLORS[i % GARLAND_COLORS.length], y = yAt(x + 2) - 1;
    sprite(g, GARLAND_FLOWER, x, y, pal);
    // and a little white blossom between each two
    if (x + 9 < w - 2) bloom(g, x + 9, yAt(x + 9) + 1, "#fff6ee", "#ffffff", "#ead8d0", CENTRE);
  }
}

// ------------------------------------------------------------ the window's valance
// a fresh mint valance with a blossom every other scallop
function valance(g, x, y, w, frame) {
  const edge = "#5a3a2c";
  g.rect(x - 2, y - 1, w + 4, 1, edge); g.rect(x - 3, y - 2, 2, 3, edge); g.rect(x + w + 1, y - 2, 2, 3, edge);
  for (let i = 0; i < w; i++) {
    const scallop = [4, 5, 5, 5, 4, 3][i % 6];
    for (let j = 0; j < scallop; j++)
      g.rect(x + i, y + j, 1, 1, j === 0 ? "#c9ecd8" : j >= scallop - 1 ? "#fff6ee" : "#9fd3b8");
    g.rect(x + i, y + scallop, 1, 1, "rgba(60,30,20,0.30)");
  }
  for (let i = 2; i < w - 2; i += 12) bloom(g, x + i, y + 2, PINK, PINK_L, PINK_D, CENTRE);
}

// ------------------------------------------------------------ the pastry case
// spring cakes: a blossom shortcake, hanami dango, macarons, a blossom cupcake, a bunny
// daifuku and a painted egg. Each says where its candle goes when it's busy.
const PASTRIES = [
  { // blossom shortcake: pink cream, a blossom on top
    dx: 0, dy: -1, candle: [9, 2],
    rows: [
".....OO.....",
"....OqpO....",
"..OOOpcOOO..",
".OaahaaaaaO.",
"OwwwwwwwwwwO",
"OyyyyyyyyyyO",
"OrrrrrrrrrrO",
"OyyyyyyyyyyO",
".OOOOOOOOOO.",
    ], pal: {a: "#f7b3c6", h: "#ffe2ea", w: "#fffaf2", y: "#f6d79a", r: "#ef8fa6", p: "#f49ab0", q: "#ffe2ea", c: "#f6d36b"}},
  { // hanami dango: pink, white and green, on a skewer, on a little plate
    dx: -2, dy: 0, candle: [8, 1],
    rows: [
"...............",
"..OOO.OOO.OOO..",
".OhppOhwwOhggO.",
"kOpppOwwwOgggOk",
".OppqOwwvOggnO.",
"..OOO.OOO.OOO..",
".OdddddddddddO.",
"..OOOOOOOOOOO..",
    ], pal: {p: "#f7b3c6", q: "#e5859f", h: "#ffe2ea", w: "#fffaf2", v: "#e6dccf", g: "#a6d68a", n: "#78b264", k: "#c9a070", d: "#e8f2f4"}},
  { // macarons: pink on mint
    dx: 0, dy: -1, candle: [7, 0],
    rows: [
"..OOOOOOOO..",
".OahaaaaabO.",
".OwwwwwwwwO.",
".OaaaaaabbO.",
"..OOOOOOOO..",
".OmhmmmmmnO.",
".OwwwwwwwwO.",
".OmmmmmmnnO.",
"..OOOOOOOO..",
    ], pal: {a: "#f7b3c6", b: "#e5859f", h: "#ffe2ea", w: "#fffaf2", m: "#a8e0c8", n: "#78c0a4"}},
  { // lilac cupcake with a blossom
    dx: 0, dy: 0, candle: [8, 1],
    rows: [
"....OOOO....",
"...OahaaO...",
"..OaaaaabO..",
".OaaahaabbO.",
".OOOOOOOOOO.",
"..OyqyqyqO..",
"..OyqyqyqO..",
"...OOOOOO...",
    ], pal: {a: "#cdb6ee", b: "#a890d6", h: "#efe4ff", y: "#ffe9ef", q: "#f7b3c6"},
    topping: [5, -1]},
  { // bunny daifuku
    dx: 0, dy: -2, candle: [6, 2],
    rows: [
"..OO....OO..",
".OpwO..OwpO.",
".OpwO..OwpO.",
".OpwO..OwpO.",
".OpwOOOOwpO.",
".OwwwwwwwwO.",
"OwwKwwwwKwwO",
"OwcwwppwwcwO",
"OwwwwwwwwssO",
".OOOOOOOOOO.",
    ], pal: {w: "#fffaf4", s: "#eadbd6", p: "#f7b3c6", c: "#f9c6d3", K: INK}},
  { // a painted egg cookie
    dx: 0, dy: 0, candle: [6, 0],
    rows: [
"....OOOO....",
"...OhaaaO...",
"..OhaaaabO..",
"..OzzzzzzO..",
".OaaaaaaabO.",
".OaYaaYaaYO.",
"..OaaaaabO..",
"...OOOOOO...",
    ], pal: {a: "#a8e0c8", b: "#78c0a4", h: "#e2f6ec", z: "#f49ab0", Y: "#f6d36b"}},
];
function candle(g, cx, base, f) {
  g.rect(cx, base - 3, 1, 3, "#fffaf2"); g.rect(cx, base - 2, 1, 1, "#f49ab0");
  g.rect(cx, base - 5, 1, 2, "#ff8a2e"); g.rect(cx, base - 5 - (f ? 1 : 0), 1, 1, "#ffd23e");
  g.rect(cx + (f ? 1 : -1), base - 4, 1, 1, "#ffb84a");
}
function pastry(g, x, y, index, busy, frame) {
  const p = PASTRIES[index % PASTRIES.length];
  sprite(g, p.rows, x + p.dx, y + p.dy, Object.assign({O: INK}, p.pal));
  if (p.topping) bloom(g, x + p.topping[0], y + p.topping[1], PINK, PINK_L, PINK_D, CENTRE);
  if (busy) candle(g, x + p.candle[0], y + p.candle[1], (frame || 0) % 2);
}

// ------------------------------------------------------------ decorations
const POT = [
"OOOOOOOOO",
"OpppppqqO",
"OOOOOOOOO",
".OphppqO.",
".OphpqqO.",
"..OOOOO..",
];
const POT_PAL = {O: INK, p: "#d98758", q: "#b5653f", h: "#f0a878"};
// tulips: (x, y) the pot's bottom-left; heights and colours of the three flowers
// a tulip's cup, its top at (sx, top): three petal tips over a rounded cup
function tulip(g, sx, top, c) {
  const cl = mix(c, "#ffffff", 0.45), cd = mix(c, "#5a2a40", 0.25);
  g.rect(sx - 1, top - 1, 3, 3, INK); g.rect(sx - 2, top, 5, 3, INK); g.rect(sx - 1, top + 3, 3, 1, INK);
  g.rect(sx - 1, top, 3, 3, c); g.rect(sx - 1, top - 1, 1, 1, c); g.rect(sx + 1, top - 1, 1, 1, c);
  g.rect(sx - 1, top, 1, 2, cl); g.rect(sx + 1, top + 1, 1, 2, cd);
}
function drawTulips(g, x, y, colors) {
  const stems = [[2, 6], [4, 8], [6, 5]];
  stems.forEach(([dx, hgt], i) => {
    const sx = x + dx, top = y - 6 - hgt;
    g.rect(sx, top + 2, 1, hgt, LEAF_D);
    tulip(g, sx, top, colors[i]);
  });
  // leaves at the foot of the stems
  g.rect(x + 1, y - 9, 1, 3, LEAF); g.rect(x + 2, y - 8, 1, 2, LEAF);
  g.rect(x + 7, y - 8, 1, 2, LEAF); g.rect(x + 6, y - 7, 1, 1, LEAF);
  sprite(g, POT, x, y - POT.length, POT_PAL);
}

// the big pot of spring flowers in the front-left corner, in place of the potted plant:
// tulips and daisies, the right-hand ones leaning out where the kittens come to bat at them
const BIG_POT = [
"OOOOOOOOOOOOOOOOOOOO",
"OhhpppppppppppppqqqO",
"OOOOOOOOOOOOOOOOOOOO",
".OhpppppppppppppqqO.",
".OhpBpppBpppBpppqqO.",
"..OhpppppppppppqqO..",
"..OhppppppppppppqO..",
"...OhpppppppppqqO...",
"...OOOOOOOOOOOOOO...",
];
const BIG_POT_PAL = {O: INK, p: "#d98758", q: "#b5653f", h: "#f0a878", B: "#f7d9b0"};
// stems: [foot dx, head dx, head height above the pot, kind, colour]
const POT_FLOWERS = [
  [5, 2, 13, "daisy", "#fff6ee"], [7, 5, 19, "tulip", "#f28aa0"], [9, 9, 23, "tulip", "#f6d36b"],
  [11, 13, 18, "tulip", "#c8a8ec"], [12, 17, 21, "tulip", "#f28aa0"], [14, 21, 15, "daisy", "#fff6ee"],
  [15, 24, 10, "tulip", "#fff4f0"], [8, 7, 11, "daisy", "#f6d36b"], [13, 12, 9, "daisy", "#ffd9e6"],
];
function plant(g, x, y, frame) {
  g.rect(x + 2, y - 1, 18, 2, "rgba(70,36,24,0.20)");
  const rim = y - BIG_POT.length;
  // broad tulip leaves fanning out of the pot
  for (const [dx, h, lean] of [[3, 7, -1], [6, 9, -1], [14, 9, 1], [17, 6, 1], [10, 8, 0]])
    for (let i = 0; i < h; i++) {
      const lx = x + dx + Math.round(lean * i * 0.4);
      g.rect(lx, rim - i, 2, 1, i > h - 3 ? LEAF : LEAF_D);
      if (i < h - 2) g.rect(lx + (lean < 0 ? 1 : 0), rim - i, 1, 1, LEAF);
    }
  for (const [foot, head, h, kind, c] of POT_FLOWERS) {
    const fx = x + foot, hx = x + head, top = rim - h;
    const steps = rim - top;
    for (let i = 0; i <= steps; i++) g.rect(Math.round(fx + (hx - fx) * i / steps), rim - i, 1, 1, LEAF_D);
    if (kind === "tulip") tulip(g, hx, top, c);
    else {
      g.rect(hx - 2, top - 1, 5, 3, INK); g.rect(hx - 1, top - 2, 3, 5, INK);
      bloom(g, hx, top, c, "#ffffff", mix(c, "#7a5060", 0.2), CENTRE);
    }
  }
  sprite(g, BIG_POT, x, rim, BIG_POT_PAL);
}

// a tall jug of cherry branches for the floor corner: (x, y) its bottom-left
const JUG = [
"..OOOOO..",
"..OwwvO..",
"...OwO...",
"..OwwwO..",
".OwhwwvO.",
"OwwhwwwvO",
"OwwhwwwvO",
"OwwhwwwvO",
"OwwwwwvvO",
".OwwwvvO.",
"..OOOOO..",
];
const JUG_PAL = {O: INK, w: "#b9d8e6", v: "#8fb7cc", h: "#e4f2f8"};
function drawJug(g, x, y) {
  g.rect(x + 1, y, 9, 1, "rgba(70,36,24,0.20)");
  // the branches: from the jug's neck up and out, blossoms along them
  const twigs = [[[4, 0], [3, -4], [1, -8], [-1, -12], [-3, -16], [-4, -19]],
                 [[4, 0], [5, -5], [7, -9], [8, -13], [9, -17]],
                 [[4, 0], [4, -6], [3, -11], [4, -16], [3, -21], [4, -25]],
                 [[3, -8], [0, -9], [-3, -8]]];
  const top = y - JUG.length;
  for (const twig of twigs)
    for (let i = 1; i < twig.length; i++) {
      const [ax, ay] = twig[i - 1], [bx, bz] = twig[i];
      const steps = Math.max(Math.abs(bx - ax), Math.abs(bz - ay));
      for (let s = 0; s <= steps; s++)
        g.rect(x + Math.round(ax + (bx - ax) * s / steps), top + Math.round(ay + (bz - ay) * s / steps), 1, 1, BARK);
    }
  for (const [dx, dy] of [[-4, -19], [-1, -13], [-4, -8], [9, -17], [7, -10], [4, -25], [3, -20], [4, -15], [0, -5], [8, -4], [2, -10]])
    bloom(g, x + dx, top + dy, PINK, PINK_L, PINK_D, "#fff4c0");
  for (const [dx, dy] of [[-5, -16], [1, -23], [10, -14], [-2, -10], [6, -22], [5, -6]]) g.rect(x + dx, top + dy, 1, 1, PINK_D);
  sprite(g, JUG, x, top, JUG_PAL);
}

// little blossoms tucked into the hanging plants: offsets from the plant's left edge
const HANGING_BLOOMS = [[2, 6], [9, 5], [12, 8], [0, 15], [0, 25], [12, 18], [12, 30], [4, 22], [9, 28], [9, 37], [1, 33]];

function decor(g, w, frame, places) {
  // blossoms in the hanging plants
  for (const px of [1, w - 14])
    HANGING_BLOOMS.forEach(([dx, dy], i) =>
      bloom(g, px + dx, dy, i % 3 === 1 ? "#fff6ee" : PINK, i % 3 === 1 ? "#ffffff" : PINK_L, i % 3 === 1 ? "#e9d8d0" : PINK_D, CENTRE));
  // cream blossoms worked into the rug
  const rug = places.rug, ry = rug.y + rug.h / 2;
  for (const dx of [10, 28, 46, 64, 82]) {
    const big = dx === 46;
    bloom(g, rug.x + dx, ry, "#fff3e6", "#ffffff", "#f0cdbd", big ? "#f6c24a" : "#f6d36b");
    if (big) { g.rect(rug.x + dx - 2, ry, 1, 1, "#fff3e6"); g.rect(rug.x + dx + 2, ry, 1, 1, "#fff3e6"); g.rect(rug.x + dx, ry - 2, 1, 1, "#fff3e6"); g.rect(rug.x + dx, ry + 2, 1, 1, "#fff3e6"); }
  }
  // tulips on the window sill, one pot at each end
  const win = places.window, sill = win.y + 31;
  drawTulips(g, win.x + 1, sill, ["#f28aa0", "#f6d36b", "#f28aa0"]);
  drawTulips(g, win.x + win.w - 10, sill, ["#c8a8ec", "#fff4f0", "#c8a8ec"]);
  // a jug of cherry branches in the front corner, past the bowls
  drawJug(g, w - 11, places.h - 2);
  // and a few of its petals fallen round its foot
  for (const [dx, dy] of [[-16, -3], [-9, -1], [-20, 1], [-4, 0]]) {
    g.rect(w - 11 + dx, places.h - 2 + dy, 2, 1, PINK); g.rect(w - 10 + dx, places.h - 1 + dy, 1, 1, PINK_D);
  }
}

// ------------------------------------------------------------ the cats' flower hats
// Each cat wears a flower tucked in at one ear, the side fixed per cat: five petals about a
// round centre, outlined in the cat's own outline colour. Keys: O outline, l/p/d petal lit,
// main and shade, c/C the centre and its shade. Drawn for the left ear; mirrored for the right.
const HAT = [
"...OOO...",
".OOlppOO.",
"OlpdpdlpO",
"OpppcppdO",
".OpccCdO.",
"OlpdCdpdO",
"OpppOppdO",
".OOO.OOO.",
];
// each cat's flower is picked by the hue of its fur, so it stands out: yellow on blue, lilac
// and pink fur, pink on green, lilac on amber and orange, white on red
const HAT_FLOWERS = {
  pink: {l: "#ffd9e6", p: "#ff9fc0", d: "#e7779d", c: "#ffd23e", C: "#e8a030"},
  yellow: {l: "#fff4b0", p: "#ffd84a", d: "#e9ad2c", c: "#f08a3c", C: "#c8662c"},
  white: {l: "#ffffff", p: "#fff6ee", d: "#e3d6d0", c: "#ffd23e", C: "#e8a030"},
  lilac: {l: "#efe2ff", p: "#c9a8f0", d: "#a487d6", c: "#ffd23e", C: "#e8a030"},
};
function hue(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  if (!c) return 0;
  const h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return (h * 60 + 360) % 360;
}
function hatFor(accent) {
  const h = hue(accent);
  return HAT_FLOWERS[h < 10 ? "white" : h < 90 ? "lilac" : h < 180 ? "pink" : "yellow"];
}
function catOutfit(g, head, accent, frame) {
  // just inside the ear, over its base; a startled cat's fur lifts it
  const right = (head.seed || 0) % 2 === 1, hw = HAT[0].length;
  const dx = 3, x = right ? head.x + head.w - dx - hw : head.x + dx;
  const y = head.y - 1 - (head.startled ? 1 : 0);
  sprite(g, HAT, x, y, Object.assign({O: catPalette(accent).O}, hatFor(accent)), right);
}

// ------------------------------------------------------------ drifting petals
// a few petals drifting slowly down and across the room, fluttering as they fall
function front(g, w, h, frame) {
  const n = Math.max(3, Math.round(w / 70));
  for (let i = 0; i < n; i++) {
    const speed = 0.35 + pick(i, 3) * 0.25, span = h + 20;
    const y = Math.round((pick(i, 9) * span + frame * speed) % span) - 10;
    const drift = frame * 0.18 + Math.sin(frame / 7 + i * 2.1) * 4;
    const x = Math.round((((i + pick(i, 17)) / n * (w + 20) + drift) % (w + 20)) - 10);
    const turn = Math.floor(frame / 3 + i) % 4;
    if (turn === 0) { g.rect(x, y, 2, 1, PINK); g.rect(x + 1, y + 1, 2, 1, PINK_D); g.rect(x, y, 1, 1, PINK_L); }
    else if (turn === 1) { g.rect(x, y, 2, 2, PINK); g.rect(x, y, 1, 1, PINK_L); g.rect(x + 1, y + 1, 1, 1, PINK_D); }
    else if (turn === 2) { g.rect(x + 1, y, 1, 1, PINK_L); g.rect(x, y + 1, 2, 1, PINK); }
    else { g.rect(x, y, 1, 2, PINK); g.rect(x + 1, y + 1, 1, 2, PINK_D); g.rect(x, y, 1, 1, PINK_L); }
  }
}

art.registerTheme("spring", {sky, valance, bunting, pastry, plant, decor, catOutfit, front});
})(typeof globalThis === "object" ? globalThis : this);
