// ============================================================
// PILOT — Tree-sitter-based JavaScript analyzer
// ============================================================
//
// Second language in the tree-sitter expansion. The Parser/Language
// loading mechanics (the part that took many rounds to debug for
// Python) are proven — this file only needs JavaScript's own node
// type names, which haven't been verified against a real parse yet.
// If a check silently finds nothing it should find, or node.type
// values in the walk don't match what's expected, that's the first
// thing to check — report back whatever pilot-test.mjs prints.

import Parser from "web-tree-sitter";

let JSLang = null;
let ready = false;

async function ensureReady(wasmPaths) {
  if (ready) return;
  await Parser.init();
  JSLang = await Parser.Language.load(wasmPaths.javascript);
  ready = true;
}

export async function analyzeJavaScriptAst(sourceCode, wasmPaths) {
  await ensureReady(wasmPaths);

  const parser = new Parser();
  parser.setLanguage(JSLang);
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

    // Empty catch block: `catch (e) { }` — the catch_clause's body
    // (a statement_block) has zero named children. Unlike Python,
    // JS doesn't require a `pass`-equivalent filler, so "empty" here
    // just means no statements at all.
    if (node.type === "catch_clause") {
      const body = node.childForFieldName("body");
      if (body && body.namedChildCount === 0) {
        issues.push({
          line: node.startPosition.row + 1,
          type: "review",
          message: "This error handler is empty — the exception is silently swallowed. Consider at least logging it, even if no other action is needed.",
        });
      }
    }

    // Unreachable code after `return`: same approach as Python — the
    // real next sibling inside the same block, not an indentation
    // guess.
    if (node.type === "return_statement") {
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

// SETUP: same web-tree-sitter@0.22.6 install as Python. Grammar wasm
// expected at node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm
// — pilot-test.mjs already prints the full directory contents, so if
// the filename is different, that'll be visible immediately.
