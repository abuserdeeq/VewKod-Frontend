// ============================================================
// Kotlin analyzer — Tree-sitter (AST) based
// ============================================================
// Same architecture as python.js/java.js: single async
// analyzeAst(code) entry point. Replaces the old regex/
// indentation-based analyzer entirely (no dual maintenance) and
// folds in what was pilot/kotlinTreeSitter.js.
//
// CONFIDENCE NOTES (carried over + extended from the pilot):
// Kotlin's tree-sitter grammar (fwcd/tree-sitter-kotlin) is
// community-maintained and exposes far fewer named fields than
// Java's/C#'s official grammars — most nodes are read by scanning
// namedChildren for a type rather than childForFieldName(). Verified
// via inspect-ast.mjs during the pilot round: function_declaration's
// name is a bare simple_identifier child (no "name" field);
// class_declaration's name is simple_identifier or type_identifier;
// an empty catch_block has no "statements" child at all. Everything
// else below (property_declaration, when_expression, call_expression
// shape, import_header) is a reasonable-but-unverified extrapolation
// from that same grammar's public docs — run
// `node src/localEngine/pilot/inspect-ast.mjs` after `npm install`
// to confirm before trusting this in production, per the project's
// established pattern for new-language pilots.

import Parser from "web-tree-sitter";
import { findCommonIssues, mdCode } from "../shared/patterns.js";

export const id = "kotlin";
export const label = "Kotlin";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

const WASM_CORE_PATH = isNode
  ? "./node_modules/web-tree-sitter/tree-sitter.wasm"
  : "/wasm/tree-sitter.wasm";
const WASM_KOTLIN_PATH = isNode
  ? "./node_modules/tree-sitter-wasms/out/tree-sitter-kotlin.wasm"
  : "/wasm/tree-sitter-kotlin.wasm";

export function detect(code) {
  // Same heuristic as the old regex-based analyzer — detection runs
  // before we know it's Kotlin at all, so it stays text-based/sync.
  return /\bfun\s+main\s*\(/.test(code) || (/\b(val|var)\s+\w+/.test(code) && /\bfun\s+\w+/.test(code)) || /\bprintln\s*\(/.test(code);
}

let KotlinLang = null;
let ready = false;

async function ensureReady() {
  if (ready) return;
  await Parser.init(isNode ? undefined : { locateFile: () => WASM_CORE_PATH });
  KotlinLang = await Parser.Language.load(WASM_KOTLIN_PATH);
  ready = true;
}

function lineOf(node) {
  return node.startPosition.row + 1;
}

// Kotlin's grammar rarely tags a "name" field — find the first
// identifier-shaped child instead. Matches the pilot's verified
// approach for function/class declarations, generalized.
function findName(node, types = ["simple_identifier", "type_identifier"]) {
  const nameNode = node.childForFieldName("name") || node.namedChildren.find((c) => types.includes(c.type));
  return nameNode ? nameNode.text : "?";
}

// Finds the initializer expression after `=` in a property_declaration
// by scanning ALL children (node.children), not just namedChildren.
// BUG FIX (found via CI, not the local sandbox — see file header):
// `null` is apparently an anonymous token in tree-sitter-kotlin's
// grammar, so `var x: String? = null` has only ONE namedChild
// (variable_declaration) — namedChildren[last] silently returned the
// declaration itself instead of the value, so declarations
// initialized to `null` got no line explanation at all. Walking all
// children and locating the literal `=` token is immune to whichever
// literals the grammar treats as anonymous.
function findInitializer(node) {
  const children = node.children;
  const eqIndex = children.findIndex((c) => c.type === "=");
  return eqIndex !== -1 ? children[eqIndex + 1] : null;
}

function literalRole(node) {
  if (!node) return null;
  if (node.type === "call_expression" && /^(listOf|mutableListOf|arrayListOf)$/.test(node.namedChildren[0]?.text || "")) return "list";
  if (node.type === "call_expression" && /^(mapOf|mutableMapOf|hashMapOf)$/.test(node.namedChildren[0]?.text || "")) return "dict";
  if (node.type === "string_literal") return "string";
  if (node.type === "boolean_literal") return "boolean";
  if (node.type === "integer_literal" || node.type === "real_literal") return "number";
  return null;
}

// ------------------------------------------------------------
// Per-function/method symbol tracking
// ------------------------------------------------------------

function buildSymbols(scopeNode) {
  const symbols = new Map();
  function scan(node) {
    if (node.type === "property_declaration") {
      const decl = node.namedChildren.find((c) => c.type === "variable_declaration");
      const name = decl ? decl.namedChildren.find((c) => c.type === "simple_identifier") : null;
      const value = findInitializer(node);
      const role = literalRole(value);
      if (name && role) symbols.set(name.text, role);
    }
    if (node.type === "for_statement") {
      const varNode = node.namedChildren.find((c) => c.type === "variable_declaration" || c.type === "simple_identifier");
      const loopVar = varNode && varNode.type === "variable_declaration"
        ? varNode.namedChildren.find((c) => c.type === "simple_identifier")
        : varNode;
      if (loopVar) symbols.set(loopVar.text, "loop-item");
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
    case "import_header":
      return "Imports a class or package so it can be used in this file.";

    case "class_declaration": {
      const name = findName(node);
      const isData = node.text.trim().startsWith("data class");
      return isData
        ? `Defines the data class \`${name}\`, which auto-generates value equality, \`toString()\`, and copying.`
        : `Defines the class \`${name}\`, which can serve as a blueprint for creating objects.`;
    }

    case "function_declaration": {
      const name = findName(node, ["simple_identifier"]);
      const paramsNode = node.namedChildren.find((c) => c.type === "function_value_parameters");
      const params = paramsNode ? paramsNode.text.slice(1, -1).trim() : "";
      return params
        ? `Defines the function \`${name}\`, which accepts ${mdCode(params)} as parameter(s).`
        : `Defines the function \`${name}\` without parameters.`;
    }

    case "for_statement": {
      const varNode = node.namedChildren.find((c) => c.type === "variable_declaration" || c.type === "simple_identifier");
      const loopVar = varNode && varNode.type === "variable_declaration"
        ? varNode.namedChildren.find((c) => c.type === "simple_identifier")
        : varNode;
      const iterable = node.namedChildren.find((c) => c !== varNode && c.type !== "control_structure_body");
      const iterableText = iterable ? iterable.text : "?";
      const role = iterable && iterable.type === "simple_identifier" ? symbols.get(iterable.text) : null;
      const phrase = role === "list" ? `the ${mdCode(iterableText)} list` : mdCode(iterableText);
      return `Iterates over ${phrase}; on each pass, ${mdCode(loopVar ? loopVar.text : "?")} represents the current item.`;
    }

    case "while_statement":
      return "Starts a while loop that keeps running while its condition stays true.";

    case "if_expression": {
      // Kotlin has no dedicated "else if" node — an else-branch that
      // is itself another if_expression is how chained conditions
      // appear in the tree.
      const isElseIf = node.parent && node.parent.type === "if_expression" && node.parent.namedChildren[node.parent.namedChildren.length - 1] === node;
      const condition = node.namedChildren.find((c) => c.type !== "control_structure_body")?.text || "?";
      return isElseIf
        ? `Checks another condition (${mdCode(condition)}) when the previous one was not met.`
        : `Checks whether ${mdCode(condition)} is true before running the code that follows.`;
    }

    case "when_expression":
      return "Starts a when expression that picks a branch based on the value.";

    case "try_expression":
      return "Starts a `try` block; if an error/exception occurs anywhere inside it, execution jumps to the matching `catch` block below.";

    case "finally_block":
      return "Starts a `finally` block, which always runs after the `try`/`catch`, whether or not an exception occurred.";

    case "catch_block": {
      const param = node.namedChildren.find((c) => c.type === "simple_identifier");
      const type = node.namedChildren.find((c) => c.type === "user_type" || c.type === "type_identifier");
      const inner = [param?.text, type?.text].filter(Boolean).join(": ");
      return inner
        ? `Catches an exception/error here (${mdCode(inner)}) if one was thrown in the \`try\` block above.`
        : "Catches any exception/error thrown in the `try` block above.";
    }

    case "jump_expression": {
      const value = node.namedChildren[0];
      if (!node.text.trim().startsWith("return")) return null; // break/continue: no separate line worth adding
      return value
        ? `Returns ${mdCode(value.text)} from the current function.`
        : "Returns control from the current function.";
    }

    case "property_declaration": {
      const decl = node.namedChildren.find((c) => c.type === "variable_declaration");
      const name = decl ? decl.namedChildren.find((c) => c.type === "simple_identifier") : null;
      const value = findInitializer(node);
      const isVal = /^val\b/.test(node.text.trim());
      const kind = isVal ? "read-only" : "mutable";
      if (!name || !value) return null;
      return `Declares the ${kind} property ${mdCode(name.text)} and assigns it ${mdCode(value.text)}.`;
    }

    case "call_expression": {
      // println/print — Kotlin's most common output call.
      const callee = node.namedChildren[0];
      if (callee && callee.type === "simple_identifier" && /^(println|print)$/.test(callee.text)) {
        const argsNode = node.namedChildren.find((c) => c.type === "call_suffix");
        const args = argsNode ? argsNode.text.replace(/^\(|\)$/g, "").trim() : "";
        return args ? `Prints ${mdCode(args)} to the console, followed by a newline.` : "Prints a blank line to the console.";
      }
      // Only surface a call as its own line when it's a standalone
      // statement (parent is a statements/function block), matching
      // the old regex analyzer's "bare call" behavior.
      if (node.parent && (node.parent.type === "statements" || node.parent.type === "function_body")) {
        const argsNode = node.namedChildren.find((c) => c.type === "call_suffix");
        const args = argsNode ? argsNode.text.replace(/^\(|\)$/g, "").trim() : "";
        const name = callee ? callee.text : "?";
        return args ? `Calls \`${name}()\`, passing \`${args}\`.` : `Calls \`${name}()\` without passing any arguments.`;
      }
      return null;
    }

    case "assignment": {
      const left = node.namedChildren[0];
      const op = node.children.find((c) => /^[+\-*/]=$/.test(c.text))?.text;
      const right = node.namedChildren[1];
      if (op) {
        const opVerbs = { "+=": ["Increases", "by"], "-=": ["Decreases", "by"], "*=": ["Multiplies", "by"], "/=": ["Divides", "by"] };
        const [verb, prep] = opVerbs[op] || ["Updates", "by"];
        return `${verb} ${mdCode(left ? left.text : "?")} ${prep} ${mdCode(right ? right.text : "?")}.`;
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

  if (node.type === "jump_expression" && node.text.trim().startsWith("return")) {
    const next = node.nextNamedSibling;
    if (next && next.type !== "comment") {
      issues.push({
        line: lineOf(next),
        type: "warning",
        message: "This line comes right after a `return` in the same block, so it can never be reached.",
      });
    }
  }

  // `!!` non-null assertion — throws an NPE-equivalent if the value
  // is actually null. Tree-sitter-kotlin models this as a postfix
  // expression whose operator text is "!!" (GUESS — verify locally).
  if (node.type === "postfix_expression" && node.text.trim().endsWith("!!")) {
    issues.push({
      line: lineOf(node),
      type: "warning",
      message: "The `!!` non-null assertion throws if the value is actually `null`. A safe call `?.` is usually safer.",
    });
  }

  if (node.type === "call_expression") {
    const callee = node.namedChildren[0]?.text || "";
    const argsNode = node.namedChildren.find((c) => c.type === "call_suffix");
    const hasConcat = argsNode && /\+/.test(argsNode.text);
    if ((/Runtime\.getRuntime\(\)\.exec/.test(node.text) || /^ProcessBuilder$/.test(callee)) && hasConcat) {
      issues.push({
        line: lineOf(node),
        type: "security",
        message: "A process is launched with a concatenated command string. If any part comes from user input, this is a command-injection risk — pass arguments as a list instead.",
      });
    }
  }
}

// ------------------------------------------------------------
// Structure
// ------------------------------------------------------------

function updateStructure(node, structure) {
  const lineNumber = lineOf(node);

  if (node.type === "comment") {
    structure.comments.push(lineNumber);
  } else if (node.type === "function_declaration") {
    const name = findName(node, ["simple_identifier"]);
    const paramsNode = node.namedChildren.find((c) => c.type === "function_value_parameters");
    structure.functions.push({ line: lineNumber, name, parameters: paramsNode ? paramsNode.text.slice(1, -1).trim() : "" });
  } else if (node.type === "class_declaration") {
    structure.classes.push({ line: lineNumber, name: findName(node) });
  } else if (node.type === "import_header") {
    structure.imports.push(lineNumber);
  } else if (node.type === "property_declaration") {
    const decl = node.namedChildren.find((c) => c.type === "variable_declaration");
    const name = decl ? decl.namedChildren.find((c) => c.type === "simple_identifier") : null;
    if (name) structure.variables.push({ line: lineNumber, name: name.text });
  } else if (node.type === "for_statement" || node.type === "while_statement") {
    structure.loops.push(lineNumber);
  } else if (node.type === "if_expression" || node.type === "when_expression") {
    structure.conditionals.push(lineNumber);
  } else if (node.type === "jump_expression" && node.text.trim().startsWith("return")) {
    structure.returns.push(lineNumber);
  } else if (node.type === "call_expression" && /^(println|print)$/.test(node.namedChildren[0]?.text || "")) {
    structure.outputs.push(lineNumber);
  }
}

// ------------------------------------------------------------
// Single entry point
// ------------------------------------------------------------

export async function analyzeAst(code) {
  await ensureReady();

  const parser = new Parser();
  parser.setLanguage(KotlinLang);
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
      const body = node.namedChildren.find((c) => c.type === "function_body");
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
