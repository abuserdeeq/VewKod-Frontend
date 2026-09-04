// Copies the .wasm files the Tree-sitter-based local-engine
// analyzers (Python, JavaScript, TypeScript, PHP, Java, C#, C, C++,
// and more to follow) need at runtime from node_modules into
// public/wasm/, so Vite serves them as static assets (reachable at
// /wasm/... in the browser). Runs automatically as a postinstall
// step — no manual copying needed after `npm install`.
//
// If either source file is missing (e.g. a package's internal
// folder structure changed), this warns instead of crashing the
// install — the app still builds, but that language's local-engine
// fallback would fail at runtime until the path is fixed. Report
// any "[copy-wasm] Skipping missing file" warning back so the path
// can be corrected.

import fs from "node:fs";

const copies = [
  {
    from: "node_modules/web-tree-sitter/tree-sitter.wasm",
    to: "public/wasm/tree-sitter.wasm",
    note: "web-tree-sitter core runtime",
  },
  {
    from: "node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm",
    to: "public/wasm/tree-sitter-python.wasm",
    note: "Python grammar",
  },
  {
    from: "node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm",
    to: "public/wasm/tree-sitter-javascript.wasm",
    note: "JavaScript grammar",
  },
  {
    from: "node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm",
    to: "public/wasm/tree-sitter-typescript.wasm",
    note: "TypeScript grammar",
  },
  {
    from: "node_modules/tree-sitter-wasms/out/tree-sitter-java.wasm",
    to: "public/wasm/tree-sitter-java.wasm",
    note: "Java grammar",
  },
  {
    from: "node_modules/tree-sitter-wasms/out/tree-sitter-c_sharp.wasm",
    to: "public/wasm/tree-sitter-c_sharp.wasm",
    note: "C# grammar",
  },
  {
    from: "node_modules/tree-sitter-wasms/out/tree-sitter-php.wasm",
    to: "public/wasm/tree-sitter-php.wasm",
    note: "PHP grammar",
  },
  {
    from: "node_modules/tree-sitter-wasms/out/tree-sitter-c.wasm",
    to: "public/wasm/tree-sitter-c.wasm",
    note: "C grammar",
  },
  {
    from: "node_modules/tree-sitter-wasms/out/tree-sitter-cpp.wasm",
    to: "public/wasm/tree-sitter-cpp.wasm",
    note: "C++ grammar",
  },
];

fs.mkdirSync("public/wasm", { recursive: true });

for (const { from, to, note } of copies) {
  if (!fs.existsSync(from)) {
    console.warn(`[copy-wasm] Skipping missing file (${note}): ${from}`);
    continue;
  }
  fs.copyFileSync(from, to);
  console.log(`[copy-wasm] Copied ${note}: ${from} -> ${to}`);
}
