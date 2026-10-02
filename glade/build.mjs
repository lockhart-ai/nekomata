#!/usr/bin/env node
// Builds Nekomata as a Glade plugin: a folder Glade loads beside its terminal
// (see "Glade" in the README). It holds manifest.json, the icon, and one
// self-contained index.html: the same page the server serves, with
// web/glade.js inlined ahead of app.js so the scene is fed by Glade's plugin
// events instead of /data. Glade's sandbox allows inline script and style and
// nothing remote, so everything is inlined and nothing is fetched.
//
//   node glade/build.mjs [--out <dir>]   # default: dist/glade/nekomata
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGIN_ID = "nekomata";

const read = (path) => readFileSync(join(ROOT, path), "utf8");

/**
 * The plugin's manifest.json, versioned with the extension. It asks for Glade's
 * `machine` capability (the Mac's CPU, GPU and Docker load), which stays off
 * until it's turned on in Glade's Settings › Plugins.
 */
export function manifest() {
  const { version } = JSON.parse(read("extension/package.json"));
  return {
    id: PLUGIN_ID, name: "Nekomata", version, entry: "index.html", icon: "icon.svg",
    capabilities: ["machine"],
  };
}

/** The single inlined page: styles, then the Glade adapter and the scene. */
export function page() {
  const script = read("web/glade.js") + "\n" + read("web/app.js");
  if (/<\/script/i.test(script)) throw new Error("the inlined script must not contain </script");
  return read("web/index.html")
    .replace("/*__STYLES__*/", () => read("web/styles.css"))
    .replace("/*__APP__*/", () => script);
}

/** Writes the plugin folder to `out` (replacing it) and returns its path. */
export function build(out = join(ROOT, "dist", "glade", PLUGIN_ID)) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest(), null, 2) + "\n");
  writeFileSync(join(out, "index.html"), page());
  copyFileSync(join(ROOT, "glade", "icon.svg"), join(out, "icon.svg"));
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  const out = build(values.out ? resolve(values.out) : undefined);
  console.log(`Built the Glade plugin in ${out}`);
}
