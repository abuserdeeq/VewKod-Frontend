// ============================================================
// PILOT — Tree-sitter-based C analyzer
// ============================================================
// C has no exceptions and no classes. The one real wrinkle: C's
// "declarator" syntax means a function's name isn't a simple direct
// field the way JS/Python expose it — it's nested inside a
// function_declarator. findIdentifier() below recursively digs for
// it instead of guessing a fixed field path.

import Parser from "web-tree-sitter";

let CLang = null;
let ready = false;

async function ensureReady(wasmPaths) {
  if (ready) return;
  await Parser.init();
  CLang = await Parser.Language.load(wasmPaths.c);
  ready = true;
}

function findIdentifier(node) {
  if (!node) return null;
  if (node.type === "identifier") return node;
  for (const child of node.namedChildren) {
    const found = findIdentifier(child);
    if (found) return found;
  }
  return null;
}

export async function analyzeCAst(sourceCode, wasmPaths) {
  await ensureReady(wasmPaths);

  const parser = new Parser();
  parser.setLanguage(CLang);
  const tree = parser.parse(sourceCode);
  const root = tree.rootNode;

  const functions = [];
  const classes = [];
  const issues = [];

  function walk(node) {
    if (node.type === "function_definition") {
      const declarator = node.childForFieldName("declarator");
      const nameNode = findIdentifier(declarator);
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

// SETUP: node_modules/tree-sitter-wasms/out/tree-sitter-c.wasm
