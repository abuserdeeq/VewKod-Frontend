// Run in CI via the "AST Config Verification" workflow (or locally
// with: node scripts/verify-ast-configs.mjs) — extends the same
// idea as src/localEngine/pilot/pilot-test.mjs (which validated the
// Python-only pilot) to every language listed in astConfigs.js /
// treeSitterEngine.js's WASM_FILENAMES, in one pass.
//
// For each language: loads its grammar straight out of
// node_modules/tree-sitter-wasms (no browser, no /wasm/ HTTP path
// involved — this only checks the node-type *mappings* in
// astConfigs.js are correct for the installed grammar version), and
// parses a small sample designed to exercise every construct that
// config claims to recognize: a function, a class (if the language
// has one), unreachable code after `return`, and an empty catch
// block (if the language has try/catch).
//
// Read the printed output: a language producing empty
// functions/classes/issues where the sample clearly has them means
// a node-type name in astConfigs.js needs correcting for that
// language — paste the output back so that entry can be fixed in
// one round-trip, same as the Python path was.

import fs from "node:fs";
import Parser from "web-tree-sitter";
import { WASM_FILENAMES } from "../src/localEngine/core/treeSitterEngine.js";
import { AST_CONFIGS } from "../src/localEngine/core/astConfigs.js";
import { extractFunctionsAndClasses, extractIssues } from "../src/localEngine/core/astWalk.js";

const wasmDir = "./node_modules/tree-sitter-wasms/out";
if (fs.existsSync(wasmDir)) {
  console.log(`Contents of ${wasmDir}:`, fs.readdirSync(wasmDir));
} else {
  console.log(`${wasmDir} does not exist — check tree-sitter-wasms actually installed.`);
}

const SAMPLES = {
  python: `def check(x):\n    if x > 0:\n        return x\n        print("unreachable")\n    return -1\n\ndef process(data):\n    try:\n        risky(data)\n    except Exception:\n        pass\n`,
  javascript: `function check(x) {\n  if (x > 0) {\n    return x;\n    console.log("unreachable");\n  }\n  return -1;\n}\nfunction process(data) {\n  try {\n    risky(data);\n  } catch (e) {\n  }\n}\n`,
  typescript: `function check(x: number): number {\n  if (x > 0) {\n    return x;\n    console.log("unreachable");\n  }\n  return -1;\n}\n`,
  java: `class Demo {\n  int check(int x) {\n    if (x > 0) {\n      return x;\n    }\n    return -1;\n  }\n  void process() {\n    try {\n      risky();\n    } catch (Exception e) {\n    }\n  }\n}\n`,
  c: `int check(int x) {\n  if (x > 0) {\n    return x;\n    printf("unreachable");\n  }\n  return -1;\n}\n`,
  cpp: `class Demo {\n  int check(int x) {\n    if (x > 0) {\n      return x;\n    }\n    return -1;\n  }\n};\n`,
  csharp: `class Demo {\n  int Check(int x) {\n    if (x > 0) {\n      return x;\n    }\n    return -1;\n  }\n  void Process() {\n    try {\n      Risky();\n    } catch (Exception e) {\n    }\n  }\n}\n`,
  go: `func check(x int) int {\n  if x > 0 {\n    return x\n  }\n  return -1\n}\n`,
  rust: `fn check(x: i32) -> i32 {\n  if x > 0 {\n    return x;\n  }\n  return -1;\n}\n`,
  php: `<?php\nfunction check($x) {\n  if ($x > 0) {\n    return $x;\n  }\n  return -1;\n}\n`,
  bash: `check() {\n  echo "hi"\n}\n`,
};

async function verifyLanguage(languageId) {
  const filename = WASM_FILENAMES[languageId];
  const config = AST_CONFIGS[languageId];
  const sample = SAMPLES[languageId];
  console.log(`\n===== ${languageId} (${filename}) =====`);

  if (!filename || !config || !sample) {
    console.log("skipped — missing wasm filename, config, or sample");
    return;
  }

  const wasmPath = `${wasmDir}/${filename}`;
  if (!fs.existsSync(wasmPath)) {
    console.log(`SKIPPED — grammar file not found at ${wasmPath}`);
    return;
  }

  try {
    const Language = Parser.Language || Parser.prototype?.Language;
    const lang = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(sample);

    const { functions, classes } = extractFunctionsAndClasses(tree.rootNode, config);
    const issues = extractIssues(tree.rootNode, config);

    console.log("functions:", JSON.stringify(functions));
    console.log("classes:", JSON.stringify(classes));
    console.log("issues:", JSON.stringify(issues));
  } catch (err) {
    console.log("ERROR:", err?.message || err);
  }
}

async function main() {
  console.log("[pilot] Parser.init() starting...");
  await Parser.init();
  console.log("[pilot] Parser.init() done.");

  for (const languageId of Object.keys(WASM_FILENAMES)) {
    await verifyLanguage(languageId);
  }
}

main();
