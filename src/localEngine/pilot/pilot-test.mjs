// Run: node src/localEngine/pilot/pilot-test.mjs
//
// Tests every language pilot currently under development. Not part
// of the app or the test suite — paste whatever this prints back
// into the chat.

import fs from "node:fs";
import { analyzePythonAst } from "./pythonTreeSitter.js";
import { analyzeJavaScriptAst } from "./jsTreeSitter.js";

const wasmPaths = {
  python: "./node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm",
  javascript: "./node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm",
};

const wasmDir = "./node_modules/tree-sitter-wasms/out";
if (fs.existsSync(wasmDir)) {
  console.log(`Contents of ${wasmDir}:`, fs.readdirSync(wasmDir));
} else {
  console.log(`${wasmDir} does not exist.`);
}

// ---------------- Python ----------------

const pythonSamples = {
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

console.log("\n\n########## PYTHON ##########");
for (const [label, code] of Object.entries(pythonSamples)) {
  console.log(`\n===== ${label} =====`);
  try {
    const result = await analyzePythonAst(code, wasmPaths);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("ERROR — message:", err && err.message);
    console.error("ERROR — stack:", err && err.stack);
  }
}

// ---------------- JavaScript ----------------

const jsSamples = {
  "unreachable + empty catch": `function calculateFee(amount, count) {
  if (count > 0) {
    return amount / count;
    console.log("This will never run");
  }

  return amount / 0;
}

function processOrder(order) {
  try {
    return chargeCard(order);
  } catch (e) {
  }
}
`,
  "non-empty catch should NOT be flagged": `function processOrder(order) {
  try {
    return chargeCard(order);
  } catch (e) {
    log(e);
  }
}
`,
  "if/return should NOT be flagged as unreachable": `function check(x) {
  if (x > 0) {
    return x;
  }
  return -1;
}
`,
};

console.log("\n\n########## JAVASCRIPT ##########");
for (const [label, code] of Object.entries(jsSamples)) {
  console.log(`\n===== ${label} =====`);
  try {
    const result = await analyzeJavaScriptAst(code, wasmPaths);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("ERROR — message:", err && err.message);
    console.error("ERROR — stack:", err && err.stack);
  }
}
