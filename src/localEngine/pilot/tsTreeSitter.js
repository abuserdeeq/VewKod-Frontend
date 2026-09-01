// ============================================================
// PILOT — Tree-sitter-based TypeScript analyzer
// ============================================================
// tree-sitter-typescript's grammar is built on top of the JavaScript
// grammar, so node type names are expected to match jsTreeSitter.js
// almost exactly. High confidence this works with little/no changes.

import Parser from "web-tree-sitter";

let TSLang = null;
let ready = false;

async function ensureReady(wasmPaths) {
  if (ready) return;
  await Parser.init();
  TSLang = await Parser.Language.load(wasmPaths.typescript);
  ready = true;
}

export async function analyzeTypeScriptAst(sourceCode, wasmPaths) {
  await ensureReady(wasmPaths);

  const parser = new Parser();
  parser.setLanguage(TSLang);
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

// SETUP: grammar wasm expected at
// node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm
