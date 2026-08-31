// Run: node src/localEngine/pilot/pilot-test.mjs
//
// Tests every language pilot currently under development. Not part
// of the app or the test suite — paste whatever this prints back
// into the chat.

import fs from "node:fs";
import { analyzePythonAst } from "./pythonTreeSitter.js";
import { analyzeJavaScriptAst } from "./jsTreeSitter.js";
import { analyzeTypeScriptAst } from "./tsTreeSitter.js";
import { analyzeGoAst } from "./goTreeSitter.js";
import { analyzeRustAst } from "./rustTreeSitter.js";

const wasmPaths = {
  python: "./node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm",
  javascript: "./node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm",
  typescript: "./node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm",
  go: "./node_modules/tree-sitter-wasms/out/tree-sitter-go.wasm",
  rust: "./node_modules/tree-sitter-wasms/out/tree-sitter-rust.wasm",
};

const wasmDir = "./node_modules/tree-sitter-wasms/out";
if (fs.existsSync(wasmDir)) {
  console.log(`Contents of ${wasmDir}:`, fs.readdirSync(wasmDir));
} else {
  console.log(`${wasmDir} does not exist.`);
}

async function runSamples(label, analyzeFn, samples, wasmPaths) {
  console.log(`\n\n########## ${label} ##########`);
  for (const [caseLabel, code] of Object.entries(samples)) {
    console.log(`\n===== ${caseLabel} =====`);
    try {
      const result = await analyzeFn(code, wasmPaths);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("ERROR — message:", err && err.message);
      console.error("ERROR — stack:", err && err.stack);
    }
  }
}

// ---------------- Python ----------------

await runSamples("PYTHON", analyzePythonAst, {
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
}, wasmPaths);

// ---------------- JavaScript ----------------

await runSamples("JAVASCRIPT", analyzeJavaScriptAst, {
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
}, wasmPaths);

// ---------------- TypeScript ----------------

await runSamples("TYPESCRIPT", analyzeTypeScriptAst, {
  "unreachable + empty catch": `function calculateFee(amount: number, count: number): number {
  if (count > 0) {
    return amount / count;
    console.log("This will never run");
  }

  return amount / 0;
}

function processOrder(order: Order): boolean {
  try {
    return chargeCard(order);
  } catch (e) {
  }
}
`,
  "non-empty catch should NOT be flagged": `function processOrder(order: Order): boolean {
  try {
    return chargeCard(order);
  } catch (e) {
    log(e);
  }
}
`,
  "if/return should NOT be flagged as unreachable": `function check(x: number): number {
  if (x > 0) {
    return x;
  }
  return -1;
}
`,
}, wasmPaths);

// ---------------- Go ----------------

await runSamples("GO", analyzeGoAst, {
  "unreachable (no catch equivalent in Go)": `func calculateFee(amount float64, count int) float64 {
	if count > 0 {
		return amount / float64(count)
		fmt.Println("This will never run")
	}

	return amount / 0
}
`,
  "if/return should NOT be flagged as unreachable": `func check(x int) int {
	if x > 0 {
		return x
	}
	return -1
}
`,
}, wasmPaths);

// ---------------- Rust ----------------

await runSamples("RUST", analyzeRustAst, {
  "unreachable (no catch equivalent in Rust)": `fn calculate_fee(amount: i32, count: i32) -> i32 {
    if count > 0 {
        return amount / count;
        println!("This will never run");
    }

    return amount / 0;
}
`,
  "if/return should NOT be flagged as unreachable": `fn check(x: i32) -> i32 {
    if x > 0 {
        return x;
    }
    return -1;
}
`,
}, wasmPaths);
