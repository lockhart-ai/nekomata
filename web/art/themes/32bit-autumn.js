// Nekomata's 32bit cafe dressed for autumn: turning trees through the window (rain when
// it's cool, a golden sun when it's warm), a garland of leaves, pies and pumpkin-spice
// lattes in the case, a plaid rug, a few leaves drifting in, and a knitted scarf on every cat.
(function (root) {
"use strict";
const art = root.NekomataArt["32bit"];
const {sprite, disc, mix, hash, INK} = art.kit;

const dot = (g, x, y, color) => g.rect(x, y, 1, 1, color);
const LEAF_COLORS = ["#d9483a", "#e8823a", "#e8b83a", "#b8683a"];

// ------------------------------------------------------------ the window: turning trees
const CLOUD = [
"....www.....",
"..wwwwwww...",
".wwwwwwwwww.",
"wwwwwwwwwwww",
".ssssssssss.",
];
const RAIN_CLOUD = [
"......wwww..........",
"...wwwwwwwwww...www.",
".wwwwwwwwwwwwwwwwwww",
"wwwwwwwwwwwwwwwwwwww",
"ssssssssssssssssssss",
];
// a tree: its crown is a few clumps of leaves, (dx, dy, r) from the top of its trunk
const BIG = [[-3, 1, 4], [3, 1, 4], [0, -2, 4]], SMALL = [[-2, 1, 3], [2, 1, 3], [0, -1, 3]];
const TREES = [
  {x: 35, y: 15, clumps: SMALL, c: "#e8823a", d: "#b8582a", l: "#f6a85a"},
  {x: 47, y: 12, clumps: BIG, c: "#d9483a", d: "#a0302a", l: "#ee7a5a"},
  {x: 6, y: 17, clumps: SMALL, c: "#e8b83a", d: "#b8862a", l: "#f6d870"},
];

// state: 0 cool (grey and raining), 1 warm (a soft golden afternoon), 2 hot (a blazing amber sun)
function sky(g, gx, gy, gw, gh, state, frame) {
  const f = frame % 2;
  const tones = [["#9eacb8", "#b0bcc6", "#c2ccd2"], ["#8cc4e2", "#b4d8ea", "#f6e2b4"],
    ["#f0a058", "#f6bc78", "#f9d69a"]][state];
  g.rect(gx, gy, gw, gh, tones[0]);
  g.rect(gx, gy + 9, gw, gh - 9, tones[1]);
  g.rect(gx, gy + 15, gw, gh - 15, tones[2]);
  const sx = gx + 17, sy = gy + 11;
  if (state === 0) {
    // the sun a pale smudge behind a bank of rain cloud
    disc(g, sx, sy, 3, "#d6dade");
    sprite(g, RAIN_CLOUD, gx + 4, gy + 6, {w: "#d4dae0", s: "#b8c2ca"});
    sprite(g, RAIN_CLOUD, gx + 34, gy + 3, {w: "#d4dae0", s: "#b8c2ca"});
  } else if (state === 1) {
    const ray = "#f6c85a";
    for (const [dx, dy, w, h] of [[-9, 0, 2, 1], [8, 0, 2, 1], [0, -9, 1, 2], [0, 8, 1, 2]])
      g.rect(sx + dx, sy + dy, w, h, ray);
    disc(g, sx, sy, 5, "#f4b83a"); disc(g, sx, sy, 4, "#fbd870");
    sprite(g, CLOUD, gx + 36, gy + 5, {w: "#fff8ec", s: "#e8dcc8"});
  } else {
    const ray = "#e8602e", L = f ? 4 : 3;
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      g.rect(sx + (ux > 0 ? 9 : ux < 0 ? -9 - L : -1), sy + (uy > 0 ? 9 : uy < 0 ? -9 - L : -1),
        ux ? L + 1 : 2, uy > 0 ? 2 : uy ? L + 1 : 2, ray);
    disc(g, sx, sy, 7, "#f07a2e"); disc(g, sx, sy, 6, "#f8a03a"); disc(g, sx, sy, 4, "#fcd070");
  }
  // rolling stubble fields
  const far = ["#a8a070", "#d8b86a", "#d89a50"][state], near = ["#8a8a58", "#b8944a", "#b87a3a"][state];
  const farH = [2, 3, 4, 5, 5, 6, 6, 6, 5, 5, 4, 3, 3, 2, 2, 2, 3, 4, 5, 6, 7, 7, 7, 6, 6, 5, 4, 3];
  for (let i = 0; i < gw; i++) { const hh = farH[Math.floor(i / 2) % farH.length]; g.rect(gx + i, gy + gh - 5 - hh, 1, hh + 5, far); }
  // the trees, darker in the rain
  for (const t of TREES) {
    const dull = (c, k) => state === 0 ? mix(c, k, 0.3) : c;
    const c = dull(t.c, "#7a8090"), d = dull(t.d, "#5a6070"), l = dull(t.l, "#9aa0aa");
    const tx = gx + t.x, ty = gy + t.y;
    g.rect(tx - 1, ty, 2, gh - t.y, "#6a4630");
    for (const [dx, dy, r] of t.clumps) disc(g, tx + dx + 1, ty + dy + 1, r, d);
    for (const [dx, dy, r] of t.clumps) disc(g, tx + dx, ty + dy, r, c);
    const [hx, hy, hr] = t.clumps[2];
    g.rect(tx + hx - hr + 2, ty + hy - hr + 2, 2, 1, l);
    dot(g, tx - 2, ty + 1, d); dot(g, tx + 2, ty - 1, d); dot(g, tx, ty + 3, d);
  }
  const nearH = [3, 3, 4, 4, 5, 5, 5, 4, 4, 3, 3, 2, 2, 2, 2, 3, 3, 4, 4, 4, 3, 3, 2, 2, 2, 3, 4, 5];
  for (let i = 0; i < gw; i++) { const hh = nearH[Math.floor((i + 9) / 2) % nearH.length]; g.rect(gx + i, gy + gh - hh, 1, hh, near); }
  // leaves blowing past
  for (let i = 0; i < 4; i++) {
    const x = gx + ((i * 15 + frame) % gw), y = gy + ((i * 11 + Math.floor(frame / 2)) % (gh - 4)) + 2;
    const c = state === 0 ? "#b0703a" : LEAF_COLORS[i % LEAF_COLORS.length];
    dot(g, x, y, c); if (x + 1 < gx + gw) dot(g, x + 1, y + ((frame + i) % 2), c);
  }
  // rain: slanting streaks, and drops on the glass
  if (state === 0) {
    for (let i = 0; i < 22; i++) {
      const x0 = Math.floor(hash(i, 3) * (gw + 8)), y0 = Math.floor(hash(i, 7) * gh);
      const y = (y0 + frame * 4) % gh;
      for (let j = 0; j < 3; j++) {
        const x = gx + x0 - Math.floor((y + j) / 3) + 0, yy = gy + y + j;
        if (x >= gx && x < gx + gw && yy < gy + gh) dot(g, x, yy, "rgba(236,244,252,0.85)");
      }
    }
    for (const [dx, dy] of [[6, 20], [22, 9], [31, 18], [44, 22], [52, 8], [12, 4]]) {
      dot(g, gx + dx, gy + dy, "rgba(255,255,255,0.8)"); dot(g, gx + dx, gy + dy + 1, "rgba(80,96,110,0.35)");
    }
  }
}

// ------------------------------------------------------------ the valance and the light
// a rust valance with a cream trim, on the rod and over the sill as usual
function valance(g, x, y, w) {
  const edge = "#5a3a2c";
  g.rect(x - 2, y - 1, w + 4, 1, edge); g.rect(x - 3, y - 2, 2, 3, edge); g.rect(x + w + 1, y - 2, 2, 3, edge);
  for (let i = 0; i < w; i++) {
    const deep = [4, 5, 5, 5, 4, 3][i % 6];
    for (let j = 0; j < deep; j++)
      dot(g, x + i, y + j, j === 0 ? "#e08a5a" : j >= deep - 1 ? "#f6e2c0" : (i % 6 === 2 ? "#b0502e" : "#c8643a"));
    dot(g, x + i, y + deep, "rgba(60,30,20,0.30)");
  }
  g.rect(x - 2, y + 31, w + 4, 3, edge); g.rect(x - 1, y + 31, w + 2, 2, "#dba673"); g.rect(x - 1, y + 32, w + 2, 1, "#b47a50");
}
// a low amber light, faint when it rains
function sunbeam(g, x, state) {
  const color = ["rgba(220,228,240,0.05)", "rgba(255,214,150,0.16)", "rgba(255,180,100,0.22)"][state];
  for (let y = 67; y < 174; y++) g.rect(x + 12 + Math.floor((y - 67) * 0.75), y, 64, 1, color);
}

// ------------------------------------------------------------ bunting: a garland of leaves
const MAPLE = [          // hanging by its stem
"...s...",
"..aab..",
"aaaabbb",
".aaabb.",
"aa.ab.b",
"a..a..b",
"...a...",
];
const OAK = [
"..s..",
".aab.",
"aaabb",
".aab.",
"aaabb",
".aab.",
"..a..",
];
function bunting(g, w) {
  const yAt = (x) => 2 + [0, 1, 1, 2, 2, 2, 2, 2, 1, 1, 0, 0][Math.floor(((x % 48) + 48) % 48 / 4)];
  for (let x = 0; x < w; x++) dot(g, x, yAt(x), "#8a6448");
  for (let i = 0, x = 6; x < w - 6; x += 14, i++) {
    const c = LEAF_COLORS[(i * 3) % LEAF_COLORS.length];
    const pal = {a: c, b: mix(c, "#5a2a1a", 0.25), s: "#6a4630"};
    if (i % 2 === 0) sprite(g, MAPLE, x, yAt(x + 3), pal);
    else sprite(g, OAK, x + 1, yAt(x + 3), pal);
  }
}

// ------------------------------------------------------------ the case: pies and lattes
// `top` is where a busy treat's steam rises from
const BAKES = [
  { // pumpkin pie slice with a dollop of cream
    rows: [
"........OO..",
".......OwwO.",
"...OOOOOwOO.",
".OOaaaaaaaCO",
"OaaaaaaaaaCO",
"ObbbbbbbbbCO",
"OyyyyyyyyyyO",
".OOOOOOOOOO.",
    ], pal: {a: "#f0943a", b: "#d8782a", C: "#e8b870", y: "#d9a05e", w: "#fffaf2"}, top: 6},
  { // pumpkin-spice latte, cream and cinnamon on top
    rows: [
"...OOOO.....",
"..OwwkwO....",
".OwwwwwwO...",
"OOOOOOOOOO..",
"OccccccccOO.",
"OaaaaaaaaO.O",
"OaaaaaaaaOO.",
".OOOOOOOO...",
    ], pal: {w: "#fffaf2", k: "#b0643a", c: "#f0c890", a: "#e09048"}, top: 6},
  { // apple pie under a lattice
    rows: [
"............",
"...OOOOOO...",
".OOyLyyLyOO.",
"OyLLLLLLLLyO",
"OyrLrrLrrLyO",
"OLLLLLLLLLLO",
".OppppppppO.",
"..OOOOOOOO..",
    ], pal: {y: "#f0c878", L: "#d89a50", r: "#b8483a", p: "#b0b8c0"}, top: 6},
  { // caramel apple on a stick
    rows: [
"......O.....",
".....OsO....",
"...OOOsOO...",
"..OaahaaaO..",
".OaahaaaabO.",
".OccccccccO.",
".OcCccCccCO.",
"..OOOOOOOO..",
    ], pal: {a: "#d9483a", b: "#a8342e", h: "#f08a7a", c: "#d89a40", C: "#b8782a", s: "#c8a070"}, top: 6},
  { // cinnamon roll with icing
    rows: [
"............",
"...OOOOOO...",
".OOawwwwaOO.",
"OaabbbbbbaaO",
"OabaawwabaaO",
"OabbbbbbaabO",
".OaaaaaaaaO.",
"..OOOOOOOO..",
    ], pal: {a: "#e0a860", b: "#a8643a", w: "#fffaf2"}, top: 6},
  { // pecan tart
    rows: [
"............",
"............",
"..OOOOOOOO..",
".OykkykkyyO.",
"OykkyykkykyO",
"OccccccccccO",
".OccccccccO.",
"..OOOOOOOO..",
    ], pal: {y: "#c88a48", k: "#7a4428", c: "#e8c080"}, top: 6},
];
// busy: fresh from the oven, steaming
function pastry(g, x, y, index, busy, frame) {
  const b = BAKES[index % BAKES.length];
  sprite(g, b.rows, x, y, Object.assign({O: INK}, b.pal));
  if (!busy) return;
  const f = frame % 2;
  let top = y;
  while (top < y + 7 && !/[^.]/.test(b.rows[top - y])) top++;
  for (const [dx, phase] of [[4, 0], [7, 1]]) {
    for (let j = 0; j < 5; j++) {
      const wob = ((j + f + phase) % 4 < 2) ? 0 : 1;
      dot(g, x + dx + wob, top - 1 - j, j === 4 ? "rgba(150,122,104,0.5)" : "#a68c7a");
    }
  }
}

// ------------------------------------------------------------ decorations
const PUMPKIN = [
".....s.....",
"....sO.....",
"..OOOOOOO..",
".OaAaaAaaAO",
"OaaAaaAaaAO",
"OaaAaaAaaAO",
"OaaAaaAaaAO",
".OaAaaAaAO.",
"..OOOOOOO..",
];
const GOURD = [
"..O.",
".OgO",
".OgO",
"OggGO",
"OggGO",
".OOO.",
];
function decor(g, w, frame, places) {
  // a pumpkin and a gourd on the windowsill
  const win = places.window, sill = win.y + 31;
  sprite(g, PUMPKIN, win.x + win.w - 19, sill - PUMPKIN.length, {O: INK, a: "#f0943a", A: "#c86a2a", s: "#6a8a3a"});
  sprite(g, GOURD, win.x + win.w - 8, sill - GOURD.length, {O: INK, g: "#f2e0a0", G: "#c8b070"});

  // the two shelf mugs, now pumpkin-spice lattes heaped with cream
  const ex = places.espresso.x, shelfY = places.espresso.y + 27;
  for (const [dx, color] of [[32, "#c8643a"], [42, "#e0a838"]]) {
    const x = ex + dx, y = shelfY - 6;
    g.rect(x, y, 7, 6, INK); g.rect(x + 1, y + 1, 5, 4, color);
    g.rect(x + 1, y + 1, 1, 4, mix(color, "#ffffff", 0.4)); g.rect(x + 5, y + 1, 1, 4, mix(color, "#5a2a20", 0.25));
    g.rect(x + 7, y + 1, 2, 4, INK); g.rect(x + 7, y + 2, 1, 2, color);
    g.rect(x, y - 2, 7, 2, INK); g.rect(x + 1, y - 3, 5, 1, INK);
    g.rect(x + 1, y - 2, 5, 2, "#fffaf2"); g.rect(x + 2, y - 3, 3, 1, "#fffaf2");
    dot(g, x + 3, y - 2, "#b0643a"); dot(g, x + 2, y - 1, "#c88050");
  }

  // a warm plaid rug where the rug lies
  const r = places.rug;
  const edge = "#6e2e24";
  g.rect(r.x + 2, r.y, r.w - 4, r.h, edge); g.rect(r.x, r.y + 2, r.w, r.h - 4, edge); g.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, edge);
  for (let j = 1; j < r.h - 1; j++)
    for (let i = 1; i < r.w - 1; i++) {
      if ((j === 1 || j === r.h - 2) && (i === 1 || i === r.w - 2)) continue;
      const band = j === 5 || j === 6 || j === 10 || j === 11, stripe = (i % 14) === 5 || (i % 14) === 6;
      let c = "#c0623e";
      if (band && stripe) c = "#7a3a28";
      else if (band) c = "#d9a040";
      else if (stripe) c = "#8e4430";
      else if (j === 8) c = "#e0a870";
      dot(g, r.x + i, r.y + j, c);
    }

  // a few leaves blown in, on the floor
  const fallen = [[36, 152, 0], [70, 165, 1], [114, 158, 2], [w - 84, 150, 1], [w - 58, 162, 3]];
  for (const [x, y, k] of fallen) drawLeaf(g, x, y, LEAF_COLORS[k], (x + y) % 2);
}

// a small leaf, 4x3, tumbling between two shapes
function drawLeaf(g, x, y, color, flip) {
  const dark = mix(color, "#5a2a1a", 0.3);
  if (flip) {
    g.rect(x + 1, y, 2, 1, color); g.rect(x, y + 1, 3, 1, color); dot(g, x + 3, y + 1, dark); g.rect(x + 1, y + 2, 1, 1, dark);
  } else {
    g.rect(x, y, 2, 1, color); g.rect(x + 1, y + 1, 3, 1, color); dot(g, x, y + 1, dark); dot(g, x + 2, y + 2, dark);
  }
}

// ------------------------------------------------------------ leaves drifting in the room
function front(g, w, h, frame) {
  const count = Math.max(3, Math.round(w / 120));
  for (let i = 0; i < count; i++) {
    const span = h + 24, speed = 0.5 + hash(i, 11) * 0.35;
    const y = Math.floor((frame * speed + hash(i, 5) * span) % span) - 12;
    const lap = Math.floor((frame * speed + hash(i, 5) * span) / span);
    const x0 = Math.floor(hash(i, lap + 1) * (w - 20)) + 10;
    const x = x0 + Math.round(5 * Math.sin((frame + i * 17) / 9));
    drawLeaf(g, x, y, LEAF_COLORS[(i + lap) % LEAF_COLORS.length], Math.floor(frame / 3 + i) % 2);
  }
}

// ------------------------------------------------------------ the cats' scarves
// a knitted scarf round the neck, knotted at one side with an end hanging down. Cool-coated
// cats get a rust scarf and warm-coated ones a forest green, so it always stands out.
function catOutfit(g, head, accent) {
  const n = parseInt(accent.slice(1), 16), warm = (n >> 16 & 255) > (n & 255) + 40;
  const main = warm ? "#3f7a50" : "#c0502e", stripe = warm ? "#f2e6c8" : "#f0c050";
  const rib = mix(main, "#1a1010", 0.25);
  const x = head.x, y = head.y + 13;
  // the band, snug under the chin
  g.rect(x + 3, y, 16, 5, INK); g.rect(x + 2, y + 1, 18, 3, INK);
  g.rect(x + 3, y + 1, 16, 3, main); g.rect(x + 3, y + 2, 16, 1, stripe);
  for (let i = 4; i < 19; i += 3) { dot(g, x + i, y + 1, rib); dot(g, x + i, y + 3, rib); }
  // the knot, and its end: hanging down the cat's side, or along the cushion when asleep
  g.rect(x, y, 5, 5, INK); g.rect(x + 1, y + 1, 3, 3, main); dot(g, x + 2, y + 2, rib);
  if (head.asleep) {
    g.rect(x - 5, y + 2, 7, 4, INK); g.rect(x - 4, y + 3, 6, 2, main);
    dot(g, x - 2, y + 3, stripe); dot(g, x - 2, y + 4, stripe);
    dot(g, x - 6, y + 3, main); dot(g, x - 6, y + 5, main);
    return;
  }
  g.rect(x - 1, y + 4, 5, 8, INK);
  for (let j = 0; j < 6; j++) g.rect(x, y + 5 + j, 3, 1, (j % 3 === 1) ? stripe : main);
  for (let i = 0; i < 3; i++) g.rect(x + i, y + 12, 1, (i % 2) ? 1 : 2, main);
}

art.registerTheme("autumn", {sky, valance, sunbeam, bunting, pastry, decor, catOutfit, front});
})(typeof globalThis === "object" ? globalThis : this);
