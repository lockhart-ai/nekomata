#!/usr/bin/env node
// Writes frames of the scripted cafe run (test/scene-harness.mjs) as PNGs, to look at what a
// style draws without a browser. The overlay's text is DOM, so it isn't in the pictures.
//
//   node tools/scene-shot.mjs [--style 8bit] [--theme default] [--frames 70,135,230] [--zoom 2] [--out <dir>]
//
// Frames worth looking at: 30 (a quiet cafe), 70 (the adoption man carrying a cat in),
// 135 (a cat startled awake), 200 (carrying one out), 230 (the panel dragged wide).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { sceneScripts } from "../glade/build.mjs";
import { playCafeRun } from "../test/scene-harness.mjs";

const { values } = parseArgs({ options: {
  style: { type: "string", default: "8bit" },
  theme: { type: "string", default: "default" },
  frames: { type: "string", default: "30,70,135,200,230" },
  zoom: { type: "string", default: "2" },
  out: { type: "string", default: "scene-shots" },
} });
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const run = await playCafeRun(sceneScripts(), {
  search: `?style=${values.style}&theme=${values.theme}`,
  shots: values.frames.split(",").map(Number),
  zoom: Number(values.zoom),
});
for (const [frame, png] of run.shots) {
  const name = values.theme === "default" ? values.style : `${values.style}-${values.theme}`;
  const file = join(out, `${name}-${String(frame).padStart(3, "0")}.png`);
  writeFileSync(file, png);
  console.log(file);
}
if (run.problems.length) {
  console.error(run.problems.join("\n"));
  process.exitCode = 1;
}
