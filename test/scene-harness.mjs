// Runs the scene (web/app.js and the art it draws with) without a browser: a stub DOM, a
// canvas that paints an RGBA buffer, a simulated clock and a seeded Math.random, fed a
// scripted run of /data snapshots. Each frame is reduced to a hash of the canvas and the
// overlay's HTML, so a change to what the scene draws shows up as the first frame that differs.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRAME_MS = 320;

// ------------------------------------------------------------------ the canvas
function parseColor(color) {
  if (color[0] === "#") {
    const hex = color.length === 4 ? [...color.slice(1)].map((c) => c + c).join("") : color.slice(1);
    const n = parseInt(hex, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255, 1];
  }
  const parts = color.match(/[\d.]+/g).map(Number);
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

function makeCanvas(width, height, box) {
  let pixels = new Uint8ClampedArray(width * height * 4);
  const canvas = {
    box, fills: 0,
    get width() { return width; },
    set width(value) { width = value; pixels = new Uint8ClampedArray(width * height * 4); },
    get height() { return height; },
    set height(value) { height = value; pixels = new Uint8ClampedArray(width * height * 4); },
    get pixels() { return pixels; },
    getBoundingClientRect() {
      return {left: 0, top: 0, right: canvas.box.width, bottom: canvas.box.height,
              width: canvas.box.width, height: canvas.box.height};
    },
    getContext() { return context; },
  };
  const context = {
    fillStyle: "#000000",
    fillRect(x, y, w, h) {
      canvas.fills++;
      const [r, g, b, a] = parseColor(this.fillStyle);
      const x0 = Math.max(0, Math.round(x)), x1 = Math.min(width, Math.round(x + w));
      const y0 = Math.max(0, Math.round(y)), y1 = Math.min(height, Math.round(y + h));
      for (let py = y0; py < y1; py++)
        for (let px = x0; px < x1; px++) {
          const i = (py * width + px) * 4;
          pixels[i] = pixels[i] * (1 - a) + r * a;
          pixels[i + 1] = pixels[i + 1] * (1 - a) + g * a;
          pixels[i + 2] = pixels[i + 2] * (1 - a) + b * a;
          pixels[i + 3] = 255;
        }
    },
    clearRect() { pixels.fill(0); },
  };
  return canvas;
}

// ------------------------------------------------------------------ the page
function makeElement() {
  const classes = new Set();
  return {
    style: {}, dataset: {}, hidden: false, textContent: "", innerHTML: "",
    clientWidth: 1440, offsetHeight: 40,
    classList: {add: (c) => classes.add(c), remove: (c) => classes.delete(c),
                contains: (c) => classes.has(c)},
    addEventListener() {}, querySelectorAll() { return []; },
    getBoundingClientRect() { return {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0}; },
  };
}

/** A seeded Math: the scene's only randomness is the kittens' yarn. */
function seededMath(seed) {
  let state = seed >>> 0;
  const math = Object.create(Math);
  math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return math;
}

/**
 * Loads the scene's scripts into a fresh page and returns a driver for it.
 *   scripts: the files inlined into the page, in order, relative to the repo root
 *   snapshot(seconds): the /data payload at that time on the run's clock
 *   search: the page's query string
 *   prelude: script run ahead of the scene's (e.g. a stand-in for another host's bridge)
 */
export function loadScene({scripts, snapshot, box = {width: 1440, height: 720}, search = "", prelude = ""}) {
  const startMs = Date.parse("2026-10-02T12:00:00Z");
  const clock = {ms: startMs, raf: null, intervals: [], listeners: {}, problems: []};
  const seconds = () => (clock.ms - startMs) / 1000;
  const data = () => snapshot(seconds(), clock.ms / 1000);
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(clock.ms); }
    static now() { return clock.ms; }
  }
  const canvas = makeCanvas(720, 360, {...box});
  const elements = {scene: canvas};
  const sandbox = {
    console, Date: FakeDate, Math: seededMath(20261002), JSON, Promise, Map, Set, Object, Array,
    String, Number, Infinity, NaN, parseFloat, parseInt, isNaN, AbortController, URLSearchParams,
    document: {
      hidden: false,
      getElementById(id) { return elements[id] || (elements[id] = makeElement()); },
      addEventListener() {},
    },
    navigator: {userAgent: "scene harness (node)", sendBeacon() { return true; }},
    location: {search, reload() { clock.problems.push("location.reload was called"); }},
    innerWidth: box.width,
    addEventListener(type, listener) { (clock.listeners[type] ||= []).push(listener); },
    postMessage() {},
    requestAnimationFrame(callback) { clock.raf = callback; return 1; },
    setInterval(callback, every) { clock.intervals.push({callback, every, due: every}); return 1; },
    setTimeout() { return 0; }, clearTimeout() {},
    fetch() { return Promise.resolve({ok: true, json: () => Promise.resolve(data())}); },
  };
  sandbox.window = sandbox; sandbox.parent = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  if (prelude) vm.runInContext(prelude, sandbox);
  const source = scripts.map((file) => readFileSync(join(ROOT, file), "utf8")).join("\n")
    .replace('"__BOOTSTRAP__"', () => JSON.stringify(data()));
  vm.runInContext(source, sandbox, {filename: "scene.js"});

  const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
  const elapsed = () => clock.ms - startMs;
  return {
    canvas, elements, sandbox, problems: clock.problems,
    evaluate: (expression) => vm.runInContext(expression, sandbox),
    /** Resizes the panel the scene sits in, as dragging its edge would. */
    async resize(width, height) {
      canvas.box = {width, height};
      for (const listener of clock.listeners.resize || []) listener();
      await settle();
    },
    /** Moves the clock on one animation frame, firing rAF and interval callbacks. */
    async frame() {
      clock.ms += FRAME_MS;
      for (const timer of clock.intervals)
        while (timer.due <= elapsed()) { timer.due += timer.every; timer.callback(); }
      if (clock.raf) { const callback = clock.raf; clock.raf = null; callback(elapsed()); }
      await settle();
      const text = elements["corner-text"] ? elements["corner-text"].textContent : "";
      if (/render error|disconnected/.test(text)) clock.problems.push(`${seconds()}s: ${text}`);
    },
    /** A short hash of everything the user would see: the canvas and the overlay's HTML. */
    hash() {
      const overlay = elements.overlay ? elements.overlay.innerHTML : "";
      return createHash("sha1").update(`${canvas.width}x${canvas.height}`)
        .update(canvas.pixels).update(overlay).digest("hex").slice(0, 12);
    },
    /** The canvas as a binary PPM image, for looking at a frame while debugging. */
    ppm() {
      const header = Buffer.from(`P6\n${canvas.width} ${canvas.height}\n255\n`);
      const body = Buffer.alloc(canvas.width * canvas.height * 3);
      for (let i = 0, j = 0; i < canvas.pixels.length; i += 4, j += 3) {
        body[j] = canvas.pixels[i]; body[j + 1] = canvas.pixels[i + 1]; body[j + 2] = canvas.pixels[i + 2];
      }
      return Buffer.concat([header, body]);
    },
  };
}

// ------------------------------------------------------------------ the scripted run
const stamp = (nowSeconds, ago) => new Date((nowSeconds - ago) * 1000).toISOString();

function event(nowSeconds, ago, tool, detail, sidechain = false) {
  return {time: stamp(nowSeconds, ago), tool, detail, sidechain};
}

function session(nowSeconds, id, fields) {
  return {
    id, parent_id: "", project: "you/project", title: "", branch: "", model: "claude-sonnet",
    events: [], awaiting: "user", pending_tasks: 0, is_self: false, ...fields,
    modified_at: nowSeconds - (fields.ago ?? 0),
  };
}

/**
 * A minute and a half in the cafe, covering every state the scene draws: cats working,
 * waiting on background tasks (one finishing), raising a paw, asleep then startled awake;
 * kittens working and playing; a cat arriving and leaving with the adoption man; the window,
 * pastry case and espresso machine moving through their load states.
 */
export function cafeRun(t, now) {
  const sessions = [
    session(now, "run-working-a3", {branch: "fix-auth-timeout", ago: 4, awaiting: "model",
      events: [event(now, 4, "Edit", "/Users/you/project/penny/auth/session.py")]}),
    session(now, "run-waiting-b7", {branch: "flaky-test-retry-loop", ago: 95 + t, awaiting: "user",
      pending_tasks: t < 30 ? 2 : 1, events: [event(now, 95 + t, "Bash", "pytest -x tests/test_flaky.py")]}),
    session(now, "run-asking-c5", {title: "Reword the error messages", ago: 22 + t,
      events: [event(now, 22 + t, "AskUserQuestion", "Which tone — playful or matter-of-fact?")],
      awaiting: "question"}),
    session(now, "run-asleep-d4", {branch: "nightly-benchmarks", ago: t < 40 ? 720 + t : 2,
      awaiting: t < 40 ? "user" : "model", is_self: true,
      events: [event(now, t < 40 ? 720 + t : 2, "say", "Benchmarks done — all green.")]}),
    session(now, "run-long-tool-e8", {branch: "index-embeddings", ago: 50 + t, awaiting: "tool",
      events: [event(now, 50 + t, "Bash", "make embed-index")]}),
    session(now, "agent-kit-1", {parent_id: "run-working-a3", title: "Find the auth entry points",
      ago: 6, awaiting: "model", events: [event(now, 6, "Grep", "def authenticate(", true)]}),
    session(now, "agent-kit-2", {parent_id: "run-working-a3", ago: 3, awaiting: "tool",
      events: [event(now, 3, "Read", "penny/auth/tokens.py", true)]}),
    session(now, "agent-kit-3", {parent_id: "run-working-a3", title: "You are a reviewer",
      ago: t < 55 ? 3 : 430, awaiting: t < 55 ? "model" : "user",
      events: [event(now, t < 55 ? 3 : 430, "Bash", "git diff --stat", true)]}),
    session(now, "agent-kit-4", {parent_id: "run-working-a3", ago: 430 + t,
      events: [event(now, 430 + t, "say", "done", true)]}),
    session(now, "agent-kit-5", {parent_id: "run-long-tool-e8", ago: 5, awaiting: "model",
      events: [event(now, 5, "Edit", "similarity/embeddings.py", true)]}),
  ];
  if (t >= 20 && t < 60)
    sessions.push(session(now, "run-visitor-f1", {title: "Just adopted", ago: 1, awaiting: "model",
      events: [event(now, 1, "Write", "notes/plan.md")]}));
  const containers = [
    {name: "signal-api", status: "Up 3h", cpu: 46.0, memory: "180MiB / 2GiB"},
    {name: "penny", status: "Up 3h", cpu: 78.0, memory: "420MiB / 4GiB"},
    {name: "team-worker", status: "Up 1h", cpu: 12.0, memory: "90MiB / 2GiB"},
    {name: "ollama", status: "Up 3h", cpu: 4.0, memory: "1.1GiB / 8GiB"},
    {name: "postgres", status: "Up 3h", cpu: 31.0, memory: "300MiB / 2GiB"},
    {name: "redis", status: "Up 3h", cpu: 1.0, memory: "20MiB / 1GiB"},
    {name: "one-too-many", status: "Up 1m", cpu: 2.0, memory: "20MiB / 1GiB"},
  ];
  const total = t < 25 ? 2.0 : t < 50 ? 5.0 : 9.0;      // of 10 cores: cool, warm, hot
  return {
    generated_at: now, server_started: 1, cpu_count: 10,
    gpu: t < 15 ? null : t < 35 ? 3 : t < 55 ? 30 : 88,
    trees: [{pid: 1000, elapsed: "12:34", cpu: 320.0, rss_mb: 900, process_count: 8, rows: [
      {pid: 1, depth: 1, cpu: 180.0, elapsed: "03:20", is_wrapper: true,
       command: "EVAL_SAMPLES=5 make eval EVAL_PYTEST_ARGS=tests/eval"},
      {pid: 2, depth: 1, cpu: 90.0, elapsed: "01:12", is_wrapper: true,
       command: "pytest -x tests/test_flaky.py"},
      {pid: 3, depth: 2, cpu: 40.0, elapsed: "00:40", is_wrapper: false, command: "node"},
    ]}],
    docker: containers.slice(0, t < 10 ? 0 : t < 45 ? 4 : 7),
    sessions,
    history: [{t: now, claude: 1.6, docker: 1.4, total}],
  };
}

/**
 * Plays the cafe run and returns one hash per frame. Partway through, the panel is dragged
 * wide and then back, which re-lays the scene out.
 */
export async function playCafeRun(scripts, options = {}) {
  const scene = loadScene({scripts, snapshot: cafeRun, ...options});
  const hashes = [scene.hash()];
  for (let frame = 1; frame <= 280; frame++) {
    if (frame === 220) await scene.resize(2000, 500);
    if (frame === 250) await scene.resize(1440, 720);
    await scene.frame();
    hashes.push(scene.hash());
  }
  return {hashes, problems: scene.problems, scene};
}
