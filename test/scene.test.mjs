// Tests for what the scene draws (web/app.js with the art in web/art/), run without a
// browser by test/scene-harness.mjs. Run with `node --test`.
//
// The golden files hold one hash per frame of a scripted run. A change that is meant to
// alter what a style draws needs its golden file regenerated, and the pictures looked at:
//   UPDATE_GOLDEN=1 node --test test/scene.test.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { sceneScripts, themes } from "../glade/build.mjs";
import { cafeRun, loadScene, playCafeRun } from "./scene-harness.mjs";

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), "golden");

/** Compares a run's frame hashes with its golden file, naming the first frame that differs. */
function assertMatchesGolden(name, hashes) {
  const file = join(GOLDEN, `${name}.json`);
  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(file, JSON.stringify(hashes));
    return;
  }
  assert.ok(existsSync(file), `${name}: no golden file; run with UPDATE_GOLDEN=1 to record one`);
  const golden = JSON.parse(readFileSync(file, "utf8"));
  const differs = hashes.findIndex((hash, frame) => hash !== golden[frame]);
  assert.equal(differs, -1, `${name}: frame ${differs} is not what the golden run drew`);
  assert.equal(hashes.length, golden.length);
}

describe("the scene", () => {
  test("the 8bit style draws the cafe run exactly as it always has", async () => {
    const { hashes, problems } = await playCafeRun(sceneScripts());
    assert.deepEqual(problems, []);
    assertMatchesGolden("cafe-run-8bit", hashes);
  });

  test("the 16bit style draws the cafe run as recorded", async () => {
    const { hashes, problems } = await playCafeRun(sceneScripts(), { search: "?style=16bit&theme=none" });
    assert.deepEqual(problems, []);
    assertMatchesGolden("cafe-run-16bit", hashes);
  });

  test("the 32bit style draws the cafe run as recorded", async () => {
    const { hashes, problems } = await playCafeRun(sceneScripts(), { search: "?style=32bit&theme=none" });
    assert.deepEqual(problems, []);
    assertMatchesGolden("cafe-run-32bit", hashes);
  });

  test("the run covers the adoption man, a startle and the wide layout", async () => {
    const scene = loadScene({ scripts: sceneScripts(), snapshot: cafeRun });
    const seen = { man: false, startled: false, wide: false, sixTrees: false };
    for (let frame = 1; frame <= 280; frame++) {
      if (frame === 220) await scene.resize(2000, 500);
      if (frame === 250) await scene.resize(1440, 720);
      await scene.frame();
      if (scene.evaluate("adoptionRuns.length") > 0) seen.man = true;
      if (scene.evaluate("[...startledUntil.values()].some((until) => until > frame)")) seen.startled = true;
      if (scene.evaluate("sceneW") > 720) seen.wide = true;
      if (scene.evaluate("spots.length") === 6) seen.sixTrees = true;
    }
    assert.deepEqual(seen, { man: true, startled: true, wide: true, sixTrees: true });
    assert.equal(scene.evaluate("spots.length"), 5);
    assert.equal(scene.evaluate("sceneW"), 720);
  });

  test("an empty cafe says so", async () => {
    const scene = loadScene({
      scripts: sceneScripts(),
      snapshot: (t, now) => ({ ...cafeRun(t, now), sessions: [] }),
    });
    await scene.frame();
    assert.match(scene.elements.overlay.innerHTML, /The cafe is empty/);
    assert.deepEqual(scene.problems, []);
  });
});

describe("kittens' errands", () => {
  for (const style of ["8bit", "16bit", "32bit"]) {
    test(`${style}: a kitten swats at the plant, and naps in the sun soon after the CPU runs hot`, async () => {
      const scene = loadScene({ scripts: sceneScripts(), snapshot: cafeRun, search: `?style=${style}` });
      const done = new Map();
      for (let frame = 1; frame <= 219; frame++) {
        await scene.frame();
        const errands = JSON.parse(scene.evaluate(
          "JSON.stringify([...kittenPlay.values()].filter((p) => p.errand && p.errand.phase === 'do')" +
          ".map((p) => p.errand.kind))"));
        for (const kind of errands) if (!done.has(kind)) done.set(kind, frame);
      }
      assert.ok(done.has("plant"), `no kitten swatted at the plant (${[...done.keys()]})`);
      // the run's CPU turns hot at 50 s, about frame 156: no sun naps before that, and one
      // within a few seconds of the walk over
      assert.ok(done.get("sun") > 156 && done.get("sun") < 200, `sun nap at frame ${done.get("sun")}`);
      assert.deepEqual(scene.problems, []);
    });

    test(`${style}: a kitten on the right of the cafe goes to the bowls`, async () => {
      const scene = loadScene({ scripts: sceneScripts(), search: `?style=${style}`,
        snapshot: (t, now) => cafeRun(Math.min(t, 8), now) });       // a cool cafe: no naps
      for (let frame = 0; frame < 12; frame++) await scene.frame();
      const kinds = new Set();
      for (let frame = 0; frame < 400 && kinds.size < 2; frame++) {
        scene.evaluate(`(() => { const p = [...kittenPlay.values()][0];
          if (!p.errand) { p.x = sceneW * 0.8; p.y = sceneH * 0.8; p.ballX = p.x; p.ballY = p.y; p.nextErrand = 0; } })()`);
        await scene.frame();
        const errand = JSON.parse(scene.evaluate("JSON.stringify([...kittenPlay.values()][0].errand || null)"));
        if (errand && errand.phase === "do") kinds.add(errand.kind);
      }
      assert.deepEqual([...kinds].sort(), ["food", "water"]);
    });
  }
});

describe("seasonal themes", () => {
  test("Seasonal follows the date, and leaves gaps for the everyday cafe", () => {
    const scene = loadScene({ scripts: sceneScripts(), snapshot: cafeRun, search: "?style=32bit" });
    const on = (date) => scene.evaluate(`seasonalTheme(new Date(${JSON.stringify(date)}))`);
    assert.equal(on("2026-12-24T12:00:00"), "christmas");
    assert.equal(on("2027-01-03T12:00:00"), "christmas");
    assert.equal(on("2026-10-31T12:00:00"), "halloween");
    assert.equal(on("2026-10-02T12:00:00"), "autumn");
    assert.equal(on("2026-11-15T12:00:00"), "autumn");
    assert.equal(on("2026-04-10T12:00:00"), "spring");
    assert.equal(on("2026-07-15T12:00:00"), "summer");
    assert.equal(on("2027-02-14T12:00:00"), "winter");
    assert.equal(on("2026-06-10T12:00:00"), "none");
  });

  for (const id of themes()) {
    test(`32bit ${id}: draws the cafe run as recorded`, async () => {
      const { hashes, problems } = await playCafeRun(sceneScripts(), { search: `?style=32bit&theme=${id}` });
      assert.deepEqual(problems, []);
      assertMatchesGolden(`cafe-run-32bit-${id}`, hashes);
    });
  }

  test("a theme only dresses the style that has it, and 'none' is the everyday cafe", async () => {
    const run = async (search) => (await playCafeRun(sceneScripts(), { search })).hashes;
    assert.deepEqual(await run("?style=16bit&theme=christmas"), await run("?style=16bit&theme=none"));
    assert.notDeepEqual(await run("?style=32bit&theme=christmas"), await run("?style=32bit&theme=none"));
  });
});

describe("choosing a style", () => {
  test("?style= picks it, and one this build doesn't have keeps the default", () => {
    const pick = (search) => loadScene({ scripts: sceneScripts(), snapshot: cafeRun, search });
    assert.equal(pick("").evaluate("ART.id"), "8bit");
    assert.equal(pick("?style=16bit").evaluate("ART.id"), "16bit");
    assert.equal(pick("?style=32bit").evaluate("ART.id"), "32bit");
    assert.equal(pick("?style=64bit").evaluate("ART.id"), "8bit");
    assert.equal(pick("?revive=1&style=16bit").evaluate("ART.id"), "16bit");
  });

  test("a style handed over with the data swaps the scene while it runs", async () => {
    let style;
    const scene = loadScene({
      scripts: sceneScripts(),
      snapshot: (t, now) => ({ ...cafeRun(t, now), ...(style ? { style } : {}) }),
    });
    for (let frame = 0; frame < 80; frame++) await scene.frame();   // the visitor is being carried in
    assert.deepEqual([scene.evaluate("ART.id"), scene.canvas.width, scene.canvas.height], ["8bit", 720, 360]);
    style = "16bit";
    for (let frame = 0; frame < 10; frame++) await scene.frame();
    assert.deepEqual([scene.evaluate("ART.id"), scene.canvas.width, scene.canvas.height], ["16bit", 288, 144]);
    assert.equal(scene.elements.overlay.innerHTML.includes("nametag"), true);
    assert.equal(scene.evaluate("document.documentElement.dataset.style"), "16bit");
    // the floor started over: nobody mid-ceremony, every cat seated
    assert.equal(scene.evaluate("adoptionRuns.length"), 0);
    assert.equal(scene.evaluate("spots.length"), scene.evaluate("spotBySession.size"));
    style = "8bit";
    for (let frame = 0; frame < 10; frame++) await scene.frame();
    assert.deepEqual([scene.evaluate("ART.id"), scene.canvas.width], ["8bit", 720]);
    assert.deepEqual(scene.problems, []);
  });
});

describe("an art style", () => {
  test("each one registers itself with everything the scene asks of it", () => {
    const scene = loadScene({ scripts: sceneScripts(), snapshot: cafeRun });
    const styles = scene.evaluate("Object.keys(NekomataArt)");
    assert.ok(styles.includes("8bit"));
    for (const id of styles) {
      const missing = scene.evaluate(`(() => {
        const art = NekomataArt[${JSON.stringify(id)}];
        const numbers = ["px", "width", "height", "playTop"].filter((k) => typeof art[k] !== "number");
        const functions = ["spots", "postFor", "catAnchors", "kittenPlace", "kittenHover",
          "kittenBubble", "boardText", "drawBackdrop", "drawTree", "drawCat",
          "drawKittenWorking", "drawKittenPlaying", "drawMan"]
          .filter((k) => typeof art[k] !== "function");
        return JSON.stringify([...numbers, ...functions, ...(art.id === ${JSON.stringify(id)} ? [] : ["id"])]);
      })()`);
      assert.equal(missing, "[]", `style ${id} is missing ${missing}`);
      // the art's size times its pixel size is the 720x360 scene
      assert.equal(scene.evaluate(`NekomataArt[${JSON.stringify(id)}].width * NekomataArt[${JSON.stringify(id)}].px`), 720);
      assert.equal(scene.evaluate(`NekomataArt[${JSON.stringify(id)}].height * NekomataArt[${JSON.stringify(id)}].px`), 360);
    }
  });
});
