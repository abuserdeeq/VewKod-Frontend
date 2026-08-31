// Run locally with: node src/localEngine/pilot/pilot-test.mjs
//
// Not part of the app or the test suite — a throwaway script to
// sanity-check the tree-sitter pilot against a few sample snippets,
// including the exact kind of case (Allman-style-equivalent
// ambiguity) that the regex-based engine needed a special-cased fix
// for. Paste whatever this prints back into the chat.

import fs from "node:fs";
import { analyzePythonAst } from "./pythonTreeSitter.js";

// Adjust this path if step 2 in the setup notes lands the .wasm file
// somewhere else.
const wasmPaths = {
  python: "./node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm",
};

// If the guessed path above is wrong, this prints what's actually
// there so the path can be fixed in one round-trip instead of
// guessing blind.
const wasmDir = "./node_modules/tree-sitter-wasms/out";
if (fs.existsSync(wasmDir)) {
  console.log(`Contents of ${wasmDir}:`, fs.readdirSync(wasmDir).filter((f) => f.includes("python")));
} else {
  console.log(`${wasmDir} does not exist — check what tree-sitter-wasms actually installed under node_modules/tree-sitter-wasms/`);
}


const samples = {
  "unreachable + empty except": `def divide_scores(total, count):
    if count > 0:
        return total / count
        print("This will never run")

    return total / 0

def process(data):
    try:
        result = risky_operation(data)
    except Exception:
        pass

    return result
`,
  "non-empty except should NOT be flagged": `def process(data):
    try:
        result = risky_operation(data)
    except Exception as e:
        log(e)

    return result
`,
  "if/return should NOT be flagged as unreachable": `def check(x):
    if x > 0:
        return x
    return -1
`,
};

for (const [label, code] of Object.entries(samples)) {
  console.log(`\n===== ${label} =====`);
  try {
    const result = await analyzePythonAst(code, wasmPaths);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("ERROR — name:", err && err.name);
    console.error("ERROR — message:", err && err.message);
    console.error("ERROR — stack:", err && err.stack);
    console.error("ERROR — raw value:", err);
  }
}
