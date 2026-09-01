// ============================================================
// PILOT — Tree-sitter-based Python analyzer (CONFIRMED WORKING)
// ============================================================
//
// This is a STANDALONE experiment. It is NOT imported by
// engineRunner.js and does not affect the production local engine
// in any way yet. Confirmed working in CI on 2026-08-31 with:
//   web-tree-sitter@0.22.6 + tree-sitter-wasms@0.1.11
//
// It answers the question that started this whole detour: does a
// real AST (via tree-sitter) let us implement the two checks that
// were hardest to get right with regex/indentation — empty except
// blocks and unreachable code after `return` — more reliably than
// the current shared/patterns.js heuristics? Confirmed: yes. All
// three test samples (unreachable + empty except / non-empty except
// not flagged / normal if-return not flagged) matched exactly.

import Parser from "web-tree-sitter";

let PythonLang = null;
let ready = false;

/**
 * One-time setup. wasmPaths lets the caller point at wherever the
 * .wasm files actually end up after `npm install` — see setup notes.
 */
async function ensureReady(wasmPaths) {
  if (ready) return;
  await Parser.init();
  // IMPORTANT: `Parser.Language` does not exist until AFTER
  // Parser.init() resolves — the WASM runtime attaches it at that
  // point. It must be read fresh here, never cached/destructured at
  // module load time (that would capture `undefined` permanently).
  PythonLang = await Parser.Language.load(wasmPaths.python);
  ready = true;
}

/**
 * Parses Python source with tree-sitter and extracts:
 *  - functions / classes (structure)
 *  - empty `except` blocks (a block containing nothing but `pass`)
 *  - code that appears immediately after a `return` inside the same
 *    block (unreachable)
 *
 * Returns the same shape (`{ functions, classes, issues }`) the
 * existing regex-based analyzer already produces, so a real
 * side-by-side comparison is possible later.
 */
export async function analyzePythonAst(sourceCode, wasmPaths) {
  await ensureReady(wasmPaths);

  const parser = new Parser();
  parser.setLanguage(PythonLang);
  const tree = parser.parse(sourceCode);
  const root = tree.rootNode;

  const functions = [];
  const classes = [];
  const issues = [];

  function walk(node) {
    if (node.type === "function_definition") {
      const nameNode = node.childForFieldName("name");
      functions.push({ name: nameNode ? nameNode.text : "?", line: node.startPosition.row + 1 });
    }

    if (node.type === "class_definition") {
      const nameNode = node.childForFieldName("name");
      classes.push({ name: nameNode ? nameNode.text : "?", line: node.startPosition.row + 1 });
    }

    // Empty except block: the clause's body is a `block` whose only
    // statement is `pass`. No regex, no "does the next line say
    // pass" lookahead — tree-sitter has already grouped the block's
    // statements, so this is just "does it have exactly one child,
    // and is that child a pass statement?".
    if (node.type === "except_clause") {
      const block = node.namedChildren.find((c) => c.type === "block");
      if (block && block.namedChildCount === 1 && block.namedChild(0).type === "pass_statement") {
        issues.push({
          line: node.startPosition.row + 1,
          type: "review",
          message: "This error handler is empty — the exception is silently swallowed. Consider at least logging it, even if no other action is needed.",
        });
      }
    }

    // Unreachable code after `return`: look at the return statement's
    // actual next sibling in the tree (i.e. the next statement in the
    // same block). If tree-sitter says there IS one, it's genuinely
    // unreachable — no indentation comparison, no guessing whether a
    // dedent means we've left the block.
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

// ============================================================
// SETUP NOTES
// ============================================================
//
// 1. Install (VERSION PINNED — confirmed working combination):
//      npm install web-tree-sitter@0.22.6 tree-sitter-wasms@0.1.11
//
// 2. Grammar wasm ships prebuilt at:
//      node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm
//
// 3. Run: node src/localEngine/pilot/pilot-test.mjs
