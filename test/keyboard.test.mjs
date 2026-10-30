// Tests for keyboard navigation (web/app.js): a Tab-equivalent focus, spatial arrow
// movement, vimium-style hints, Escape, and Enter opening in Glade — run headless via
// test/scene-harness.mjs, the same way test/scene.test.mjs covers the mouse/visual side.
//
// There's no real Tab key to press headless (that's the browser's own focus engine); a
// `scene.keydown({key: "Tab"})` only exercises the bit that's ours — marking the focus it's
// about to cause as keyboard-driven — then `.focus()` on the target plays the part the
// browser would. The same `.focus()` with no preceding Tab plays a mouse click instead.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sceneScripts } from "../glade/build.mjs";
import { cafeRun, loadScene } from "./scene-harness.mjs";

const FIRST_CAT = "run-working-a3";   // the default roving target: see the harness's cafeRun

function tabTo(scene, sid) {
  scene.keydown({ key: "Tab" });
  scene.evaluate(`hoverTargetBySid.get(${JSON.stringify(sid)}).focus()`);
}

// A click: pointerdown then focus() with no preceding Tab keydown — pointer-origin, as a
// real click on a target with a tabindex (it has one, for Tab to reach it) would look.
function mouseFocusOn(scene, sid) {
  const target = scene.evaluate(`hoverTargetBySid.get(${JSON.stringify(sid)})`);
  target.dispatchEvent("pointerdown");
  target.focus();
  return target;
}

describe("keyboard navigation", () => {
  test("Tab (a keyboard focus) sets the roving target and the pixel outline; a mouse click does neither", async () => {
    const scene = loadScene({ scripts: sceneScripts(), snapshot: cafeRun });
    await scene.frame();
    const target = mouseFocusOn(scene, FIRST_CAT);
    assert.equal(scene.evaluate("overlayHasFocus"), true);     // focus did land…
    assert.equal(scene.evaluate("keyboardFocused"), false);    // …but not by keyboard
    assert.equal(scene.evaluate(`keyboardFocusedOn(${JSON.stringify(FIRST_CAT)})`), false);
    target.blur();

    // Tab: our keydown handler marks the *next* focus as keyboard-driven.
    tabTo(scene, FIRST_CAT);
    assert.equal(scene.evaluate("overlayHasFocus"), true);
    assert.equal(scene.evaluate("keyboardFocused"), true);
    assert.equal(scene.evaluate("rovingId"), FIRST_CAT);
    assert.equal(scene.evaluate(`keyboardFocusedOn(${JSON.stringify(FIRST_CAT)})`), true);
  });

  test("an arrow key moves the roving target spatially, without stepping the animation along", async () => {
    const scene = loadScene({ scripts: sceneScripts(), snapshot: cafeRun });
    await scene.frame();
    tabTo(scene, FIRST_CAT);
    const before = scene.evaluate("frame");
    let moved = null;
    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
      const event = scene.keydown({ key });
      assert.equal(event.defaultPrevented, true);               // handled either way
      assert.equal(scene.evaluate("frame"), before);            // never advances the animation
      const now = scene.evaluate("rovingId");
      if (now !== FIRST_CAT) { moved = { key, now }; break; }
      tabTo(scene, FIRST_CAT);                                   // back to start, try the next
    }
    assert.ok(moved, "no arrow direction moved the roving target");
    assert.equal(scene.evaluate("keyboardFocused"), true);
  });

  test("f shows letter hints, a hint letter jumps to that target, and Escape dismisses the hints", async () => {
    const scene = loadScene({ scripts: sceneScripts(), snapshot: cafeRun });
    await scene.frame();
    tabTo(scene, FIRST_CAT);
    scene.keydown({ key: "f" });
    assert.equal(scene.evaluate("hintsActive"), true);
    const secondId = scene.evaluate("[...hoverTargetBySid.keys()][1]");
    const hintKey = scene.evaluate(`HINT_KEYS[[...hoverTargetBySid.keys()].indexOf(${JSON.stringify(secondId)})]`);
    scene.keydown({ key: hintKey });
    assert.equal(scene.evaluate("hintsActive"), false);
    assert.equal(scene.evaluate("rovingId"), secondId);
    assert.equal(scene.evaluate("keyboardFocused"), true);        // jumping by hint is keyboard too

    scene.keydown({ key: "f" });
    assert.equal(scene.evaluate("hintsActive"), true);
    scene.keydown({ key: "Escape" });
    assert.equal(scene.evaluate("hintsActive"), false);
    assert.equal(scene.evaluate("overlayHasFocus"), true);        // Escape dismisses hints, not focus
  });

  test("hint mode only swallows Escape and a hint letter — Tab, a modifier shortcut and anything else pass through", async () => {
    const scene = loadScene({ scripts: sceneScripts(), snapshot: cafeRun });
    await scene.frame();
    tabTo(scene, FIRST_CAT);
    scene.keydown({ key: "f" });
    assert.equal(scene.evaluate("hintsActive"), true);
    assert.equal(scene.keydown({ key: "Tab" }).defaultPrevented, false);
    assert.equal(scene.keydown({ key: "s", ctrlKey: true }).defaultPrevented, false);
    assert.equal(scene.keydown({ key: "1" }).defaultPrevented, false);   // not a hint letter
    assert.equal(scene.evaluate("hintsActive"), true);                  // none of those dismissed it
  });

  test("f, arrows and Enter/Space do nothing unless focus is already inside the cat group", async () => {
    const scene = loadScene({ scripts: sceneScripts(), snapshot: cafeRun });
    await scene.frame();
    assert.equal(scene.evaluate("overlayHasFocus"), false);
    assert.equal(scene.keydown({ key: "f" }).defaultPrevented, false);
    assert.equal(scene.evaluate("hintsActive"), false);
    assert.equal(scene.keydown({ key: "ArrowRight" }).defaultPrevented, false);
    assert.equal(scene.keydown({ key: "Enter" }).defaultPrevented, false);
    assert.equal(scene.keydown({ key: " " }).defaultPrevented, false);
  });

  test("Escape, with focus in the group and no hints showing, leaves the group", async () => {
    const scene = loadScene({ scripts: sceneScripts(), snapshot: cafeRun });
    await scene.frame();
    tabTo(scene, FIRST_CAT);
    scene.keydown({ key: "Escape" });
    assert.equal(scene.evaluate("overlayHasFocus"), false);
    assert.equal(scene.evaluate("keyboardFocused"), false);
  });
});

describe("keyboard activation in Glade", () => {
  function gladeScene() {
    return loadScene({
      scripts: ["web/glade.js", ...sceneScripts()],
      snapshot: cafeRun,
      prelude: `window.glade = { post(message) { (window.__posted ||= []).push(message); } };`,
    });
  }
  function posted(scene) { return JSON.parse(scene.evaluate("JSON.stringify(window.__posted || [])")); }

  test("Enter opens the focused cat's task, the same path a click uses", async () => {
    const scene = gladeScene();
    await scene.frame();
    tabTo(scene, FIRST_CAT);
    scene.keydown({ key: "Enter" });
    assert.deepEqual(posted(scene).filter((m) => m.type === "openTask"),
      [{ type: "openTask", taskId: FIRST_CAT, subagentId: null }]);
  });

  test("Space opens a focused kitten's task and subagent", async () => {
    const scene = gladeScene();
    await scene.frame();
    tabTo(scene, "agent-kit-1");
    scene.keydown({ key: " " });
    assert.deepEqual(posted(scene).filter((m) => m.type === "openTask"),
      [{ type: "openTask", taskId: FIRST_CAT, subagentId: "agent-kit-1" }]);
  });

  test("a mouse focus on a cat does not turn on keyboard controls: arrows, Enter, Space, f and Escape do nothing", async () => {
    const scene = gladeScene();
    await scene.frame();
    mouseFocusOn(scene, FIRST_CAT);
    assert.equal(scene.evaluate("overlayHasFocus"), true);    // the click did focus it…
    assert.equal(scene.evaluate("keyboardFocused"), false);   // …but not by keyboard

    assert.equal(scene.keydown({ key: "ArrowRight" }).defaultPrevented, false);
    assert.equal(scene.evaluate("rovingId"), FIRST_CAT);       // focus didn't move
    assert.equal(scene.keydown({ key: "Enter" }).defaultPrevented, false);
    assert.equal(scene.keydown({ key: " " }).defaultPrevented, false);
    assert.equal(scene.keydown({ key: "f" }).defaultPrevented, false);
    assert.equal(scene.evaluate("hintsActive"), false);        // no hints appeared
    assert.equal(scene.keydown({ key: "Escape" }).defaultPrevented, false);
    assert.equal(scene.evaluate("overlayHasFocus"), true);     // Escape didn't blur it either

    assert.deepEqual(posted(scene).filter((m) => m.type === "openTask"), []);
  });

  test("a mouse click still opens the task on pointerup, untouched by any of this", async () => {
    const scene = gladeScene();
    await scene.frame();
    const target = scene.evaluate(`hoverTargetBySid.get(${JSON.stringify(FIRST_CAT)})`);
    target.dispatchEvent("mouseover");
    assert.equal(scene.elements.hovercard.style.display, "block");   // hover still shows the card
    target.dispatchEvent("pointerup", { button: 0 });
    assert.deepEqual(posted(scene).filter((m) => m.type === "openTask"),
      [{ type: "openTask", taskId: FIRST_CAT, subagentId: null }]);
    target.dispatchEvent("mouseout");
    assert.equal(scene.elements.hovercard.style.display, "none");
  });
});
