// ============================================================
// PILOT — Tree-sitter-based C++ analyzer
// ============================================================
// Unlike C, C++ has real try/catch and classes. Class node type is
// "class_specifier" (not "class_declaration" like the JS-family
// languages) — a naming difference specific to the C/C++ grammar
// family. Function name extraction reuses C's findIdentifier()
// approach since C++ inherits the same declarator complexity.

import Parser from "web-tree-sitter";

let CppLang = null;
let ready = false;

async function ensureReady(wasmPaths) {
  if (ready) return;
  await Parser.init();
  CppLang = await Parser.Language.load(wasmPaths.cpp);
  ready = true;
}

function findIdentifier(node) {
  if (!node) return null;
  if (node.type === "identifier" || node.type === "field_identifier") return node;
  for (const child of node.namedChildren) {
    const found = findIdentifier(child);
    if (found) return found;
  }
  return null;
}

export async function analyzeCppAst(sourceCode, wasmPaths) {
  await ensureReady(wasmPaths);

  const parser = new Parser();
  parser.setLanguage(CppLang);
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

    if (node.type === "class_specifier") {
      const nameNode = node.childForFieldName("name") || node.namedChildren.find((c) => c.type === "type_identifier");
      classes.push({ name: nameNode ? nameNode.text : "?", line: node.startPosition.row + 1 });
    }

    if (node.type === "catch_clause") {
      const body = node.childForFieldName("body") || node.namedChildren.find((c) => c.type === "compound_statement");
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

// SETUP: node_modules/tree-sitter-wasms/out/tree-sitter-cpp.wasm
