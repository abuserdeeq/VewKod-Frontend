// ============================================================
// PILOT — Tree-sitter-based Python analyzer (proof of concept)
// ============================================================
//
// This is a STANDALONE experiment. It is NOT imported by
// engineRunner.js and does not affect the production local engine
// in any way. Its only purpose is to answer one question: does a
// real AST (via tree-sitter) let us implement the two checks that
// were hardest to get right with regex/indentation — empty except
// blocks and unreachable code after `return` — more reliably than
// the current shared/patterns.js heuristics?
//
// Because this container has no network access, this file has not
// been executed here. Run pilot-test.mjs locally (see setup notes
// at the bottom of this file) and report back what happens.
//
// Why this matters: with a real syntax tree, "unreachable code" and
// "empty except" stop being about guessing indentation or brace
// position from raw text — they become "is this node the next
// sibling inside the same block?", which tree-sitter already knows
// for certain. That's what would have made the Allman-style catch
// bug structurally impossible rather than something we had to
// special-case by hand.

import Parser from "web-tree-sitter";

let PythonLang = null;
let ready = false;

/**
 * One-time setup. wasmPaths lets the caller point at wherever the
 * .wasm files actually end up after `npm install` — see setup notes.
 */
async function ensureReady(wasmPaths) {
  if (ready) return;
  console.log("[pilot] Parser.init() starting...");
  await Parser.init();
  console.log("[pilot] Parser.init() done.");

  // The nested `Parser.Language` shape assumed here previously turned
  // out to be undefined at runtime for this install. Rather than guess
  // again, check every shape the module could plausibly expose the
  // Language loader under, and report exactly what we find so the next
  // failure (if any) points at a real cause instead of another guess.
  console.log("[pilot] Parser own keys:", Object.getOwnPropertyNames(Parser));
  console.log("[pilot] typeof Parser.Language:", typeof Parser.Language);
  console.log("[pilot] typeof Parser.prototype?.Language:", typeof Parser.prototype?.Language);

  const LanguageLoader =
    Parser.Language ||
    Parser.prototype?.Language ||
    (typeof Parser.getLanguage === "function" ? Parser : null);

  if (!LanguageLoader || typeof LanguageLoader.load !== "function") {
    throw new Error(
      "[pilot] Could not find a working Language.load() on this web-tree-sitter build. " +
      "Own keys were: " + Object.getOwnPropertyNames(Parser).join(", ") +
      ". Check node_modules/web-tree-sitter/package.json 'version' and its README for this exact installed version."
    );
  }

  console.log("[pilot] Language.load() starting, path:", wasmPaths.python);
  PythonLang = await LanguageLoader.load(wasmPaths.python);
  console.log("[pilot] Language.load() done.");
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

  console.log("[pilot] creating parser + setting language...");
  const parser = new Parser();
  parser.setLanguage(PythonLang);
  console.log("[pilot] parsing source...");
  const tree = parser.parse(sourceCode);
  console.log("[pilot] parse done.");
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
// SETUP NOTES (do this on your machine — not runnable here, no
// network access in this sandbox)
// ============================================================
//
// 1. Install the runtime (VERSION PINNED — see note below):
//      npm install web-tree-sitter@0.22.6 tree-sitter-wasms@0.1.11
//    UPDATE: the assumption below (that `Parser.Language` becomes
//    available as a static property right after `Parser.init()`)
//    was tested in CI on 2026-08-31 and turned out FALSE for this
//    install — `Parser.Language` is still undefined after init()
//    resolves. ensureReady() above now logs every shape it can find
//    (Parser's own keys, Parser.Language, Parser.prototype.Language)
//    and throws a clear error listing them if none work. Run the
//    pilot test again and read those log lines to find the real
//    shape for this exact installed version before assuming either
//    shape described below is correct.
//
// 2. Get the compiled Python grammar (.wasm). The simplest source is
//    the community-maintained prebuilt bundle:
//      npm install tree-sitter-wasms
//    which ships ready-to-use files under:
//      node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm
//    (If that package or path doesn't match what actually installs,
//    tell me the exact folder contents and I'll adjust the paths.)
//
// 3. web-tree-sitter's own core runtime also needs its .wasm file
//    (usually node_modules/web-tree-sitter/tree-sitter.wasm) to be
//    reachable — for a Vite app that means copying it into /public
//    so it's served as a static asset, or configuring Vite's
//    `assetsInclude`. Exact setup can vary by web-tree-sitter
//    version, so if `Parser.init()` throws, paste the error and
//    I'll help track down the right config.
//
// 4. Run the accompanying pilot-test.mjs (same folder) with:
//      node src/localEngine/pilot/pilot-test.mjs
//    and send me whatever it prints — including any error.
