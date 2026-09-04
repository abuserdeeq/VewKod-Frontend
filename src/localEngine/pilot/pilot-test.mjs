// Run: node src/localEngine/pilot/pilot-test.mjs
//
// Tests every language pilot currently under development (Python,
// JavaScript, TypeScript, PHP, Java, C#, C, and C++ graduated to
// production — see src/localEngine/analyzers/{python,javascript,
// typescript,php,java,csharp,c,cpp}.js — so none of them are tested
// here anymore). Not part of the app or the test suite — paste
// whatever this prints back into the chat.

import fs from "node:fs";
import { analyzeGoAst } from "./goTreeSitter.js";
import { analyzeRustAst } from "./rustTreeSitter.js";
import { analyzeKotlinAst } from "./kotlinTreeSitter.js";
import { analyzeSwiftAst } from "./swiftTreeSitter.js";
import { analyzeBashAst } from "./bashTreeSitter.js";

const wasmPaths = {
  go: "./node_modules/tree-sitter-wasms/out/tree-sitter-go.wasm",
  rust: "./node_modules/tree-sitter-wasms/out/tree-sitter-rust.wasm",
  kotlin: "./node_modules/tree-sitter-wasms/out/tree-sitter-kotlin.wasm",
  swift: "./node_modules/tree-sitter-wasms/out/tree-sitter-swift.wasm",
  bash: "./node_modules/tree-sitter-wasms/out/tree-sitter-bash.wasm",
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

// ---------------- Go ----------------
await runSamples("GO", analyzeGoAst, {
  "unreachable (no catch equivalent)": `func calculateFee(amount float64, count int) float64 {
	if count > 0 {
		return amount / float64(count)
		fmt.Println("This will never run")
	}
	return amount / 0
}
`,
}, wasmPaths);

// ---------------- Rust ----------------
await runSamples("RUST", analyzeRustAst, {
  "unreachable (no catch equivalent)": `fn calculate_fee(amount: i32, count: i32) -> i32 {
    if count > 0 {
        return amount / count;
        println!("This will never run");
    }
    return amount / 0;
}
`,
}, wasmPaths);

// ---------------- Kotlin ----------------
await runSamples("KOTLIN", analyzeKotlinAst, {
  "unreachable + empty catch": `fun calculateFee(amount: Double, count: Int): Double {
    if (count > 0) {
        return amount / count
        println("This will never run")
    }
    return amount / 0
}
fun processOrder(order: Order): Boolean {
    try {
        return chargeCard(order)
    } catch (e: Exception) {
    }
    return false
}
`,
}, wasmPaths);

// ---------------- Swift ----------------
await runSamples("SWIFT", analyzeSwiftAst, {
  "unreachable + empty catch": `func calculateFee(amount: Double, count: Int) -> Double {
    if count > 0 {
        return amount / Double(count)
        print("This will never run")
    }
    return amount / 0
}
func processOrder(order: Order) -> Bool {
    do {
        return try chargeCard(order)
    } catch {
    }
}
`,
}, wasmPaths);

// ---------------- Bash ----------------
await runSamples("BASH", analyzeBashAst, {
  "unreachable (no catch/classes in Bash)": `calculate_fee() {
  local amount=$1
  local count=$2
  if [ "$count" -gt 0 ]; then
    echo $((amount / count))
    return
    echo "This will never run"
  fi
  echo $((amount / 0))
}
`,
}, wasmPaths);
