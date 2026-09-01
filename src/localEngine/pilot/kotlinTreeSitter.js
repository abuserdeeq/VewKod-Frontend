// ============================================================
// PILOT — Tree-sitter-based Kotlin analyzer
// ============================================================
// LOWER CONFIDENCE than the other files. Kotlin's tree-sitter
// grammar is community-maintained and less widely documented than
// JS/Python/Java's. function_declaration/class_declaration are
// reasonable bets, but the catch and return node type names below
// are educated guesses and more likely than the others to need a
// correction round — if issues stay empty when they shouldn't,
// that's the first thing to check.

import Parser from "web-tree-sitter";

let KotlinLang = null;
let ready = false;

async function ensureReady(wasmPaths) {
  if (ready) return;
  await Parser.init();
  KotlinLang = await Parser.Language.load(wasmPaths.kotlin);
  ready = true;
}

export async function analyzeKotlinAst(sourceCode, wasmPaths) {
  await ensureReady(wasmPaths);

  const parser = new Parser();
  parser.setLanguage(KotlinLang);
  const tree = parser.parse(sourceCode);
  const root = tree.rootNode;

  const functions = [];
  const classes = [];
  const issues = [];

  function walk(node) {
    if (node.type === "function_declaration") {
      const nameNode = node.childForFieldName("name");
      functions.push({ name: nameNode ? nameNode.text : "?", line: node.startPosition.row + 1 });
    }

    if (node.type === "class_declaration") {
      const nameNode = node.childForFieldName("name");
      classes.push({ name: nameNode ? nameNode.text : "?", line: node.startPosition.row + 1 });
    }

    // GUESS: "catch_block" (Kotlin syntax is `catch (e: Exception) { }`)
    if (node.type === "catch_block") {
      const body = node.childForFieldName("body") || node.namedChildren.find((c) => c.type === "block");
      if (body && body.namedChildCount === 0) {
        issues.push({
          line: node.startPosition.row + 1,
          type: "review",
          message: "This error handler is empty — the exception is silently swallowed. Consider at least logging it, even if no other action is needed.",
        });
      }
    }

    // GUESS: Kotlin's `return` may be wrapped as a "jump_expression"
    // rather than a plain "return_statement" — checking both.
    if (node.type === "return_statement" || node.type === "jump_expression") {
      const next = node.nextNamedSibling;
      if (next && next.type !== "comment") {
        issues.push({
          line: next.startPosition.row + 1,
          type: "warning",
          message: "This line comes right after a `return` in the same block, so it can never be reached.",
        });
      }
    }

    for (const child of node.namedChildren) walk(child);
  }

  walk(root);

  return { functions, classes, issues };
}

// SETUP: node_modules/tree-sitter-wasms/out/tree-sitter-kotlin.wasm
