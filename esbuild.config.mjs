import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const context = await esbuild.context({
  banner: {
    js: `/*! AI Knowledge Workflow — MIT License\n${readFileSync(new URL("./LICENSE", import.meta.url), "utf8")}\n${readFileSync(new URL("./THIRD_PARTY_NOTICES.md", import.meta.url), "utf8")}\n*/`
  },
  bundle: true,
  entryPoints: ["main.ts"],
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
    ...builtinModules.map((name) => "node:" + name)
  ],
  format: "cjs",
  logLevel: "info",
  minify: production,
  outfile: "main.js",
  platform: "browser",
  sourcemap: production ? false : "inline",
  target: "es2021",
  treeShaking: true
});

if (watch) {
  await context.watch();
  console.log("Watching for changes...");
} else {
  await context.rebuild();
  await context.dispose();
}
