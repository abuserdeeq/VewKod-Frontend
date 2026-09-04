// Run: node src/localEngine/pilot/pilot-test.mjs
//
// Tests every language pilot currently under development (Python,
// JavaScript, TypeScript, PHP, Java, C#, C, C++, Go, Rust, Kotlin,
// and Swift graduated to production — see src/localEngine/analyzers/
// {python,javascript,typescript,php,java,csharp,c,cpp,go,rust,
// kotlin,swift}.js — so none of them are tested here anymore). Not
// part of the app or the test suite — paste whatever this prints
// back into the chat.

import fs from "node:fs";
import { analyzeBashAst } from "./bashTreeSitter.js";

const wasmPaths = {
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
