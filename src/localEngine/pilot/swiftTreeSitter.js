// ============================================================
// PILOT — Tree-sitter-based Swift analyzer
// ============================================================
// MODERATE CONFIDENCE. Swift doesn't have "try/catch" the way most
// C-family languages do — it uses "do { try ... } catch { }", where
// `catch` has no parentheses around the error variable. The catch
// node type name below is a best guess.

import Parser from "web-tree-sitter";

let SwiftLang = null;
let ready = false;

async function ensureReady(wasmPaths) {
  if (ready) return;
  await Parser.init();
  SwiftLang = await Parser.Language.load(wasmPaths.swift);
  ready = true;
}

export async function analyzeSwiftAst(sourceCode, wasmPaths) {
  await ensureReady(wasmPaths);

  const parser = new Parser();
  parser.setLanguage(SwiftLang);
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

    // An empty catch_block's only named child is catch_keyword — no
    // "statements" node at all when the body is empty (confirmed via
    // inspect-ast.mjs).
    if (node.type === "catch_block") {
      const body = node.namedChildren.find((c) => c.type === "statements");
      if (!body) {
        issues.push({
          line: node.startPosition.row + 1,
          type: "review",
          message: "This error handler is empty — the exception is silently swallowed. Consider at least logging it, even if no other action is needed.",
        });
      }
    }

    // GUESS: Swift's return might be a "control_transfer_statement"
    // wrapping the `return` keyword, rather than a plain
    // "return_statement" — checking both.
    if (node.type === "return_statement" || node.type === "control_transfer_statement") {
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

// SETUP: node_modules/tree-sitter-wasms/out/tree-sitter-swift.wasm
