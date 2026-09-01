// ============================================================
// PILOT — Tree-sitter-based C# analyzer
// ============================================================
// C# also has no free functions — only methods inside classes.
// Grammar filename is tree-sitter-c_sharp.wasm (underscore).

import Parser from "web-tree-sitter";

let CSharpLang = null;
let ready = false;

async function ensureReady(wasmPaths) {
  if (ready) return;
  await Parser.init();
  CSharpLang = await Parser.Language.load(wasmPaths.csharp);
  ready = true;
}

export async function analyzeCSharpAst(sourceCode, wasmPaths) {
  await ensureReady(wasmPaths);

  const parser = new Parser();
  parser.setLanguage(CSharpLang);
  const tree = parser.parse(sourceCode);
  const root = tree.rootNode;

  const functions = [];
  const classes = [];
  const issues = [];

  function walk(node) {
    if (node.type === "method_declaration") {
      const nameNode = node.childForFieldName("name");
      functions.push({ name: nameNode ? nameNode.text : "?", line: node.startPosition.row + 1 });
    }

    if (node.type === "class_declaration") {
      const nameNode = node.childForFieldName("name");
      classes.push({ name: nameNode ? nameNode.text : "?", line: node.startPosition.row + 1 });
    }

    // C# catch clauses use a "catch_clause" wrapping a separate
    // "block" node — unlike JS/Java, the block may not be exposed
    // via a "body" field name, so fall back to searching children.
    if (node.type === "catch_clause") {
      const body = node.childForFieldName("body") || node.namedChildren.find((c) => c.type === "block");
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

// SETUP: node_modules/tree-sitter-wasms/out/tree-sitter-c_sharp.wasm
