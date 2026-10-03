#!/usr/bin/env node
// Builds Nekomata as a Glade plugin: a folder Glade loads beside its terminal
// (see "Glade" in the README). It holds manifest.json, the icon, and one
// self-contained index.html: the same page the server serves, with
// web/glade.js inlined ahead of the art and app.js so the scene is fed by Glade's
// plugin events instead of /data. Glade's sandbox allows inline script and style and
// nothing remote, so everything is inlined and nothing is fetched.
//
//   node glade/build.mjs [--out <dir>]   # default: dist/glade/nekomata
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGIN_ID = "nekomata";

const read = (path) => readFileSync(join(ROOT, path), "utf8");

/** The art styles this build carries (web/art/<id>.js), plainest first. */
export function styles() {
  return readdirSync(join(ROOT, "web", "art")).filter((name) => name.endsWith(".js"))
    .map((name) => name.slice(0, -3)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
}

/** The seasonal themes this build carries (web/art/themes/<style>-<id>.js), by id. */
export function themes() {
  const dir = join(ROOT, "web", "art", "themes");
  if (!existsSync(dir)) return [];
  return [...new Set(readdirSync(dir).filter((name) => name.endsWith(".js"))
    .map((name) => name.slice(0, -3).split("-").slice(1).join("-")))].sort();
}

const THEME_LABELS = { halloween: "Halloween", christmas: "Christmas", winter: "Winter",
  spring: "Spring", summer: "Summer", autumn: "Autumn" };

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
    // The art style, as a setting in Glade's Settings › Plugins (glade#435). A Glade
    // without plugin settings ignores this and the cafe stays in its default style.
    settings: [{
      key: "style", label: "Art style", type: "select",
      options: styles().map((id) => ({ value: id, label: id.replace(/bit$/, "-bit") })),
      default: "8bit",
    }, {
      // seasonal themes, for the styles that have them (32bit)
      key: "theme", label: "Theme", type: "select",
      options: [{ value: "seasonal", label: "Seasonal (by date)" }, { value: "none", label: "None" },
        ...themes().map((id) => ({ value: id, label: THEME_LABELS[id] || id }))],
      default: "seasonal",
    }],
  };
}

/** The scene's scripts, in the order the page inlines them: the art styles, then the scene. */
export function sceneScripts() {
  const themeFiles = existsSync(join(ROOT, "web", "art", "themes"))
    ? readdirSync(join(ROOT, "web", "art", "themes")).filter((name) => name.endsWith(".js")).sort()
    : [];
  return [...styles().map((id) => `web/art/${id}.js`),
    ...themeFiles.map((name) => `web/art/themes/${name}`), "web/app.js"];
}

/** The single inlined page: styles, then the Glade adapter, the art and the scene. */
export function page() {
  const script = ["web/glade.js", ...sceneScripts()].map(read).join("\n");
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
