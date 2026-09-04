// ============================================================
// Swift analyzer — Tree-sitter (AST) based
// ============================================================
// Same architecture as python.js/java.js: single async
// analyzeAst(code) entry point. Replaces the old regex/
// indentation-based analyzer entirely and folds in what was
// pilot/swiftTreeSitter.js.
//
// CONFIDENCE NOTES (carried over + extended from the pilot):
// alex-pinkus/tree-sitter-swift is more field-annotated than
// Kotlin's grammar — the pilot's function_declaration/
// class_declaration name lookups used childForFieldName("name")
// directly and worked, and an empty catch_block's only named child
// is catch_keyword (confirmed via inspect-ast.mjs). Struct/enum/
// protocol/extension declarations, guard/if-let optional binding,
// nil-coalescing, and force-unwrap below are unverified
// extrapolations from the grammar's public docs — run
// `node src/localEngine/pilot/inspect-ast.mjs` after `npm install`
// to confirm before trusting this in production.

import Parser from "web-tree-sitter";
import { findCommonIssues, mdCode } from "../shared/patterns.js";

export const id = "swift";
export const label = "Swift";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

const WASM_CORE_PATH = isNode
  ? "./node_modules/web-tree-sitter/tree-sitter.wasm"
  : "/wasm/tree-sitter.wasm";
const WASM_SWIFT_PATH = isNode
  ? "./node_modules/tree-sitter-wasms/out/tree-sitter-swift.wasm"
  : "/wasm/tree-sitter-swift.wasm";

export function detect(code) {
  return /\bimport\s+(Foundation|UIKit|SwiftUI)\b/.test(code) || (/\b(let|var)\s+\w+/.test(code) && /\bfunc\s+\w+/.test(code));
}

let SwiftLang = null;
let ready = false;

async function ensureReady() {
  if (ready) return;
  await Parser.init(isNode ? undefined : { locateFile: () => WASM_CORE_PATH });
  SwiftLang = await Parser.Language.load(WASM_SWIFT_PATH);
  ready = true;
}

function lineOf(node) {
  return node.startPosition.row + 1;
}

// GUESS: struct/enum/protocol/extension declarations may be their
// own node types rather than sharing "class_declaration" — checked
// as a set so any of these still gets picked up structurally even
// if the exact split from the grammar differs from this guess.
const TYPE_DECL_TYPES = new Set(["class_declaration", "struct_declaration", "enum_declaration", "protocol_declaration"]);

function typeKindLabel(node) {
  const first = node.child(0)?.text;
  if (first === "struct") return "struct";
  if (first === "enum") return "enum";
  if (first === "protocol") return "protocol";
  if (first === "extension") return "extension";
  return "class";
}

// Finds the initializer expression after `=` in a property_declaration
// by scanning ALL children (node.children), not just namedChildren.
// DEFENSIVE FIX: CI testing surfaced the Kotlin equivalent of this bug
// (`null` is an anonymous token in that grammar, so namedChildren
// skipped it entirely — see kotlin.js). Swift's own tests passed, but
// applying the same fix here too in case `nil` is anonymous in some
// grammar versions: relying on namedChildren[last] silently picks the
// wrong node (or the declaration itself) whenever the actual value is
// an anonymous token.
function findInitializer(node) {
  const children = node.children;
  const eqIndex = children.findIndex((c) => c.type === "=");
  return eqIndex !== -1 ? children[eqIndex + 1] : null;
}

function literalRole(node) {
  if (!node) return null;
  if (node.type === "dictionary_literal") return "dict";
  if (node.type === "array_literal") return "list";
  if (node.type === "line_string_literal" || node.type === "string_literal") return "string";
  if (node.type === "boolean_literal") return "boolean";
  if (node.type === "integer_literal" || node.type === "real_literal") return "number";
  return null;
}

// ------------------------------------------------------------
// Per-function symbol tracking
// ------------------------------------------------------------

function buildSymbols(scopeNode) {
  const symbols = new Map();
  function scan(node) {
    if (node.type === "property_declaration") {
      const pattern = node.namedChildren.find((c) => c.type === "pattern" || c.type === "simple_identifier");
      const value = findInitializer(node);
      const role = literalRole(value);
      if (pattern && role) symbols.set(pattern.text, role);
    }
    if (node.type === "for_statement") {
      const item = node.childForFieldName("item") || node.namedChildren.find((c) => c.type === "simple_identifier");
      if (item) symbols.set(item.text, "loop-item");
    }
    for (const child of node.namedChildren) scan(child);
  }
  if (scopeNode) scan(scopeNode);
  return symbols;
}

// ------------------------------------------------------------
// Per-line explanation
// ------------------------------------------------------------

function explainNode(node, symbols) {
  switch (node.type) {
    case "import_declaration":
      return "Imports a framework so its types/functions can be used in this file.";

    default:
      break;
  }

  if (TYPE_DECL_TYPES.has(node.type)) {
    const nameNode = node.childForFieldName("name");
    const name = nameNode ? nameNode.text : "?";
    return `Defines the ${typeKindLabel(node)} \`${name}\`, which can serve as a blueprint for creating objects.`;
  }

  switch (node.type) {
    case "function_declaration": {
      const nameNode = node.childForFieldName("name");
      const paramsNode = node.childForFieldName("parameters");
      const name = nameNode ? nameNode.text : "?";
      const params = paramsNode ? paramsNode.text.slice(1, -1).trim() : "";
      return params
        ? `Defines the function \`${name}\`, which accepts ${mdCode(params)} as parameter(s).`
        : `Defines the function \`${name}\` without parameters.`;
    }

    case "for_statement": {
      const item = node.childForFieldName("item") || node.namedChildren.find((c) => c.type === "simple_identifier");
      const collection = node.childForFieldName("collection");
      const collectionText = collection ? collection.text : "?";
      const role = collection && collection.type === "simple_identifier" ? symbols.get(collection.text) : null;
      const phrase = role === "list" ? `the ${mdCode(collectionText)} array` : mdCode(collectionText);
      return `Iterates over ${phrase}; on each pass, ${mdCode(item ? item.text : "?")} represents the current item.`;
    }

    case "while_statement":
      return "Starts a while loop that keeps running while its condition stays true.";

    case "guard_statement": {
      // "guard let x = expr else { ... }" vs plain "guard cond else { ... }".
      const bindings = node.namedChildren.filter((c) => c.type === "value_binding_pattern" || c.type === "optional_binding_condition");
      if (bindings.length) {
        const binding = bindings[0];
        const name = binding.namedChildren.find((c) => c.type === "simple_identifier")?.text || "?";
        const expr = node.namedChildren.find((c) => c !== binding && c.type !== "statements")?.text || "?";
        return `Unwraps ${mdCode(expr)}; if it's \`nil\`, runs the \`else\` block below (which must exit this function), otherwise makes the value available as \`${name}\` for the rest of the function (Swift's \`guard let\`).`;
      }
      const condition = node.namedChildren.find((c) => c.type !== "statements")?.text || "?";
      return `Checks whether ${mdCode(condition)} is true; if not, runs the \`else\` block below (which must exit this function) — Swift's early-exit \`guard\`.`;
    }

    case "if_statement": {
      const bindings = node.namedChildren.filter((c) => c.type === "value_binding_pattern" || c.type === "optional_binding_condition");
      if (bindings.length) {
        const binding = bindings[0];
        const name = binding.namedChildren.find((c) => c.type === "simple_identifier")?.text || "?";
        const expr = node.namedChildren.find((c) => c !== binding && c.type !== "statements")?.text || "?";
        return `If ${mdCode(expr)} isn't \`nil\`, unwraps it and makes it available as \`${name}\` inside this block (Swift's optional binding).`;
      }
      const isElseIf = node.parent && node.parent.type === "if_statement";
      const condition = node.namedChildren.find((c) => c.type !== "statements")?.text || "?";
      if (isElseIf) return `Checks another condition (${mdCode(condition)}) when the previous one was not met.`;
      const role = symbols.get(condition);
      if (role === "loop-item") return `Checks whether the current item (${mdCode(condition)}) meets the condition before running the code that follows.`;
      return `Checks whether ${mdCode(condition)} is true before running the code that follows.`;
    }

    case "switch_statement":
      return "Starts a switch statement that picks a branch based on the value.";

    case "do_statement":
      return "Starts a `try` block; if an error occurs anywhere inside it, execution jumps to the matching `catch` block below.";

    case "catch_block": {
      const body = node.namedChildren.find((c) => c.type === "statements");
      if (!body) return "Catches any exception/error thrown in the `try` block above.";
      return "Catches an exception raised in the `try` block above.";
    }

    case "control_transfer_statement": {
      if (!node.text.trim().startsWith("return")) return null; // break/continue/throw: no separate line
      const value = node.namedChildren[0];
      return value
        ? `Returns ${mdCode(value.text)} from the current function.`
        : "Returns control from the current function.";
    }

    case "property_declaration": {
      const patternNode = node.namedChildren.find((c) => c.type === "pattern");
      const name = patternNode ? patternNode.text : (node.namedChildren.find((c) => c.type === "simple_identifier")?.text || "?");
      const value = findInitializer(node);
      if (!value) return null;
      const isLet = /^let\b/.test(node.text.trim());
      const kind = isLet ? "constant" : "variable";

      const nilCoalesce = value.type === "nil_coalescing_expression" ? value : null;
      if (nilCoalesce) {
        const [left, right] = nilCoalesce.namedChildren;
        return `Declares the ${kind} \`${name}\`: uses ${mdCode(left ? left.text : "?")} if it isn't \`nil\`, otherwise falls back to ${mdCode(right ? right.text : "?")} (Swift's nil-coalescing \`??\`).`;
      }
      return `Declares the ${kind} \`${name}\` and assigns it ${mdCode(value.text)}.`;
    }

    case "call_expression": {
      const callee = node.childForFieldName("function") || node.namedChildren[0];
      if (callee && callee.type === "simple_identifier" && callee.text === "print") {
        const argsNode = node.childForFieldName("call_suffix") || node.namedChildren.find((c) => c.type === "call_suffix");
        const args = argsNode ? argsNode.text.replace(/^\(|\)$/g, "").trim() : "";
        return args ? `Prints ${mdCode(args)} to the console.` : "Prints a blank line to the console.";
      }
      return null;
    }

    default:
      return null;
  }
}

// ------------------------------------------------------------
// Issue checks
// ------------------------------------------------------------

const SUPERSEDED_MESSAGES = new Set([
  "This error handler is empty — the exception is silently swallowed. Consider at least logging it, even if no other action is needed.",
  "This line comes right after a `return` in the same block, so it can never be reached.",
]);

function checkIssues(node, issues) {
  if (node.type === "catch_block") {
    const body = node.namedChildren.find((c) => c.type === "statements");
    if (!body) {
      issues.push({
        line: lineOf(node),
        type: "review",
        message: "This error handler is empty — the exception is silently swallowed. Consider at least logging it, even if no other action is needed.",
      });
    }
  }

  if (node.type === "control_transfer_statement" && node.text.trim().startsWith("return")) {
    const next = node.nextNamedSibling;
    if (next && next.type !== "comment") {
      issues.push({
        line: lineOf(next),
        type: "warning",
        message: "This line comes right after a `return` in the same block, so it can never be reached.",
      });
    }
  }

  // Force-cast `as!` — crashes if the cast fails.
  if (node.type === "as_expression" && /\bas!\s/.test(node.text)) {
    issues.push({
      line: lineOf(node),
      type: "warning",
      message: "Force-cast `as!` will crash if the cast fails. A conditional `as?` is usually safer.",
    });
  }

  // Force-unwrap `!` at the end of a property initializer.
  if (node.type === "property_declaration" && /!\s*$/.test(node.text.trim())) {
    issues.push({
      line: lineOf(node),
      type: "review",
      message: "Force-unwrapping an optional here will crash if the value is `nil`.",
    });
  }

  if (node.type === "assignment" || node.type === "call_expression") {
    if (/\.arguments\s*=/.test(node.text) && /\+/.test(node.text)) {
      issues.push({
        line: lineOf(node),
        type: "security",
        message: "Process/task arguments are built with concatenation. If any part comes from user input, this is a command-injection risk.",
      });
    }
  }
}

// ------------------------------------------------------------
// Structure
// ------------------------------------------------------------

function updateStructure(node, structure) {
  const lineNumber = lineOf(node);

  if (node.type === "comment" || node.type === "multiline_comment") {
    structure.comments.push(lineNumber);
  } else if (node.type === "function_declaration") {
    const nameNode = node.childForFieldName("name");
    const paramsNode = node.childForFieldName("parameters");
    structure.functions.push({ line: lineNumber, name: nameNode ? nameNode.text : "?", parameters: paramsNode ? paramsNode.text.slice(1, -1).trim() : "" });
  } else if (TYPE_DECL_TYPES.has(node.type)) {
    const nameNode = node.childForFieldName("name");
    structure.classes.push({ line: lineNumber, name: nameNode ? nameNode.text : "?" });
  } else if (node.type === "import_declaration") {
    structure.imports.push(lineNumber);
  } else if (node.type === "property_declaration") {
    const patternNode = node.namedChildren.find((c) => c.type === "pattern") || node.namedChildren.find((c) => c.type === "simple_identifier");
    if (patternNode) structure.variables.push({ line: lineNumber, name: patternNode.text });
  } else if (node.type === "for_statement" || node.type === "while_statement") {
    structure.loops.push(lineNumber);
  } else if (node.type === "if_statement" || node.type === "switch_statement" || node.type === "guard_statement") {
    structure.conditionals.push(lineNumber);
  } else if (node.type === "control_transfer_statement" && node.text.trim().startsWith("return")) {
    structure.returns.push(lineNumber);
  } else if (node.type === "call_expression") {
    const callee = node.childForFieldName("function") || node.namedChildren[0];
    if (callee && callee.text === "print") structure.outputs.push(lineNumber);
  }
}

// ------------------------------------------------------------
// Single entry point
// ------------------------------------------------------------

export async function analyzeAst(code) {
  await ensureReady();

  const parser = new Parser();
  parser.setLanguage(SwiftLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;

  const structure = {
    functions: [], classes: [], imports: [], variables: [],
    loops: [], conditionals: [], returns: [], outputs: [], comments: [],
  };
  const issues = findCommonIssues(code.split("\n")).filter((issue) => !SUPERSEDED_MESSAGES.has(issue.message));
  const lineExplanations = [];

  function walk(node, symbols) {
    updateStructure(node, structure);
    checkIssues(node, issues);

    if (node.type === "function_declaration") {
      const explanation = explainNode(node, symbols);
      if (explanation) lineExplanations.push({ line: lineOf(node), text: explanation });
      const body = node.childForFieldName("body");
      const localSymbols = buildSymbols(body);
      for (const child of node.namedChildren) walk(child, localSymbols);
      return;
    }

    const explanation = explainNode(node, symbols);
    if (explanation) lineExplanations.push({ line: lineOf(node), text: explanation });

    for (const child of node.namedChildren) walk(child, symbols);
  }

  walk(root, buildSymbols(root));

  lineExplanations.sort((a, b) => a.line - b.line);

  return { structure, issues, lineExplanations };
}
