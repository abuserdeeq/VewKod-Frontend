// ============================================================
// PILOT — Tree-sitter-based Bash analyzer
// ============================================================
// HIGHEST UNCERTAINTY of the three added this round. Bash has no
// exceptions and no classes. The bigger question mark: `return` is
// a shell BUILTIN, not a dedicated language keyword the way it is
// in every other language here — so tree-sitter-bash may represent
// it as a generic "command" node (whose command_name happens to be
// the word "return") rather than its own "return_statement" node
// type. Both possibilities are checked below.

import Parser from "web-tree-sitter";

let BashLang = null;
let ready = false;

async function ensureReady(wasmPaths) {
  if (ready) return;
  await Parser.init();
  BashLang = await Parser.Language.load(wasmPaths.bash);
  ready = true;
}

function isReturnCommand(node) {
  if (node.type === "return_statement") return true;
  if (node.type === "command") {
    const nameNode = node.childForFieldName("name");
    return !!nameNode && nameNode.text === "return";
  }
  return false;
}

export async function analyzeBashAst(sourceCode, wasmPaths) {
  await ensureReady(wasmPaths);

  const parser = new Parser();
  parser.setLanguage(BashLang);
  const tree = parser.parse(sourceCode);
  const root = tree.rootNode;

  const functions = [];
  const classes = [];
  const issues = [];

  function walk(node) {
    if (node.type === "function_definition") {
      const nameNode = node.childForFieldName("name") || node.namedChildren.find((c) => c.type === "word");
      functions.push({ name: nameNode ? nameNode.text : "?", line: node.startPosition.row + 1 });
    }

    if (isReturnCommand(node)) {
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

// SETUP: node_modules/tree-sitter-wasms/out/tree-sitter-bash.wasm
