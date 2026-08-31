// Runs automatically via "postinstall" (see package.json). Copies the
// .wasm files tree-sitter needs at runtime out of node_modules and
// into public/wasm/, so Vite serves them as plain static assets and
// src/localEngine/core/treeSitterEngine.js can fetch them with a
// simple absolute path — no bundler-specific WASM plugin needed.
//
// Deliberately non-fatal: if a file is missing (wrong name for the
// installed package version, package not installed, offline install,
// etc.), this logs which one and continues, exactly like the rest of
// the tree-sitter integration — a missing/renamed file just means
// that one language never goes "warm" and the local engine keeps
// using its existing regex analyzer for it (see treeSitterEngine.js's
// module comment for the full fallback story).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WASM_FILENAMES } from "../src/localEngine/core/treeSitterEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "public", "wasm");

fs.mkdirSync(outDir, { recursive: true });

function copyIfExists(src, destName) {
  if (!fs.existsSync(src)) {
    console.warn(`[copy-wasm] skipped (not found): ${src}`);
    return false;
  }
  fs.copyFileSync(src, path.join(outDir, destName));
  console.log(`[copy-wasm] copied ${destName}`);
  return true;
}

// 1. web-tree-sitter's own core runtime wasm.
copyIfExists(
  path.join(root, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
  "tree-sitter.wasm",
);

// 2. One grammar wasm per language we know how to ask for.
const wasmsOutDir = path.join(root, "node_modules", "tree-sitter-wasms", "out");
let copied = 0;
for (const filename of Object.values(WASM_FILENAMES)) {
  if (copyIfExists(path.join(wasmsOutDir, filename), filename)) copied++;
}

console.log(`[copy-wasm] done — ${copied}/${Object.keys(WASM_FILENAMES).length} language grammar(s) copied into public/wasm/`);
