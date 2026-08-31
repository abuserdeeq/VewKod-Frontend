// ============================================================
// PILOT — Tree-sitter-based Go analyzer
// ============================================================
// Go has no try/catch (error handling is via returned `error`
// values), so there's no empty-handler check here — same limitation
// the regex engine already has for Go. Only function extraction and
// unreachable-after-return apply.

import Parser from "web-tree-sitter";

let GoLang = null;
let ready = false;

async function ensureReady(wasmPaths) {
  if (ready) return;
  await Parser.init();
  GoLang = await Parser.Language.load(wasmPaths.go);
  ready = true;
}

export async function analyzeGoAst(sourceCode, wasmPaths) {
  await ensureReady(wasmPaths);

  const parser = new Parser();
  parser.setLanguage(GoLang);
  const tree = parser.parse(sourceCode);
  const root = tree.rootNode;

  const functions = [];
  const classes = [];
  const issues = [];

  function walk(node) {
    // Go has both plain functions and methods (with a receiver).
    if (node.type === "function_declaration" || node.type === "method_declaration") {
      const nameNode = node.childForFieldName("name");
      functions.push({ name: nameNode ? nameNode.text : "?", line: node.startPosition.row + 1 });
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
// node_modules/tree-sitter-wasms/out/tree-sitter-go.wasm
