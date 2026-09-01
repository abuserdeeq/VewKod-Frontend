// ============================================================
// PILOT — Tree-sitter-based Rust analyzer
// ============================================================
// Rust has no try/catch (error handling is via `Result`/`?`), so no
// empty-handler check, same as Go. The one real uncertainty here:
// in Rust's grammar, `return` is an EXPRESSION ("return_expression"),
// not a statement — because in Rust almost everything is an
// expression. If node.type === "return_expression" never matches
// anything below, that's the first thing to check against what
// pilot-test.mjs actually reports.

import Parser from "web-tree-sitter";

let RustLang = null;
let ready = false;

async function ensureReady(wasmPaths) {
  if (ready) return;
  await Parser.init();
  RustLang = await Parser.Language.load(wasmPaths.rust);
  ready = true;
}

export async function analyzeRustAst(sourceCode, wasmPaths) {
  await ensureReady(wasmPaths);

  const parser = new Parser();
  parser.setLanguage(RustLang);
  const tree = parser.parse(sourceCode);
  const root = tree.rootNode;

  const functions = [];
  const classes = [];
  const issues = [];

  function walk(node) {
    if (node.type === "function_item") {
      const nameNode = node.childForFieldName("name");
      functions.push({ name: nameNode ? nameNode.text : "?", line: node.startPosition.row + 1 });
    }

    // return is an expression in Rust, not a statement — but a
    // return_expression that isn't the last thing in its block is
    // still normally wrapped in an expression_statement (with a
    // trailing `;`) when other code follows it. Check both node
    // types to be safe.
    if (node.type === "return_expression" || node.type === "return_statement") {
      // The return_expression itself usually has no next sibling —
      // it's alone inside its own expression_statement wrapper. The
      // real "next statement in the block" is a sibling of THAT
      // wrapper, not of the return_expression itself.
      let refNode = node;
      if (refNode.parent && refNode.parent.type === "expression_statement") {
        refNode = refNode.parent;
      }
      const next = refNode.nextNamedSibling;
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
// node_modules/tree-sitter-wasms/out/tree-sitter-rust.wasm
