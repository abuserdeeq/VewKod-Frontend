// ============================================================
// Bash analyzer — Tree-sitter (AST) based
// ============================================================
// Same architecture as python.js/java.js: single async
// analyzeAst(code) entry point. Replaces the old regex/
// indentation-based analyzer entirely and folds in what was
// pilot/bashTreeSitter.js.
//
// CONFIDENCE NOTES:
// tree-sitter-bash (tree-sitter-grammars org) is a well-maintained,
// widely-used official grammar — better documented than Kotlin's or
// Swift's, so confidence here is higher throughout. Two things are
// still worth flagging:
//   1. `return` is a shell BUILTIN, not a dedicated keyword — the
//      pilot round confirmed it can surface as either a dedicated
//      "return_statement" node OR a generic "command" node whose
//      name happens to be "return". Every return-related check below
//      dual-checks for both, carried over from that pilot finding.
//   2. Everything else (command/argument shape, variable_assignment,
//      for/while/if fields, comment) is NOT verified against the real
//      grammar in this session (no network access to npm install) —
//      run `node src/localEngine/pilot/inspect-ast.mjs` after
//      `npm install` to confirm before fully trusting it, same as
//      the Kotlin/Swift graduation.

import Parser from "web-tree-sitter";
import { findCommonIssues, mdCode } from "../shared/patterns.js";

export const id = "bash";
export const label = "Bash";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

const WASM_CORE_PATH = isNode
  ? "./node_modules/web-tree-sitter/tree-sitter.wasm"
  : "/wasm/tree-sitter.wasm";
const WASM_BASH_PATH = isNode
  ? "./node_modules/tree-sitter-wasms/out/tree-sitter-bash.wasm"
  : "/wasm/tree-sitter-bash.wasm";

export function detect(code) {
  // Same heuristic as the old regex-based analyzer.
  return /^#!.*\b(bash|sh)\b/.test(code.trim()) || (/\bfi\b/.test(code) && /\bdone\b/.test(code));
}

let BashLang = null;
let ready = false;

async function ensureReady() {
  if (ready) return;
  await Parser.init(isNode ? undefined : { locateFile: () => WASM_CORE_PATH });
  BashLang = await Parser.Language.load(WASM_BASH_PATH);
  ready = true;
}

function lineOf(node) {
  return node.startPosition.row + 1;
}

// `return` is a shell builtin — it can be its own node type OR a
// generic "command" whose name is the word "return" (verified via
// the pilot round). Every return-aware check needs both branches.
function isReturnCommand(node) {
  if (node.type === "return_statement") return true;
  if (node.type === "command") {
    const nameNode = node.childForFieldName("name");
    return !!nameNode && nameNode.text === "return";
  }
  return false;
}

// Some "command" nodes get an explicit `name` field from the grammar;
// others (e.g. a bare word like `backup_files` with no arguments) don't,
// and the name is just the first named child. commandName() and
// commandArgs() must resolve the name node the same way, or the name
// ends up double-counted as one of its own arguments.
function commandNameNode(node) {
  return node.childForFieldName("name") || node.namedChildren[0];
}

function commandName(node) {
  const nameNode = commandNameNode(node);
  return nameNode ? nameNode.text : "?";
}

function commandArgs(node) {
  const nameNode = commandNameNode(node);
  return node.namedChildren
    .filter((c) => c !== nameNode)
    .map((c) => c.text)
    .join(" ")
    .trim();
}

function literalRole(text) {
  const v = (text || "").trim();
  if (/^\(.*\)$/.test(v)) return "list";
  if (/^["'].*["']$/.test(v)) return "string";
  if (/^-?\d+$/.test(v)) return "number";
  return "variable";
}

// ------------------------------------------------------------
// Per-function/script symbol tracking
// ------------------------------------------------------------

function buildSymbols(scopeNode) {
  const symbols = new Map();
  function scan(node) {
    if (node.type === "function_definition") {
      const nameNode = node.childForFieldName("name") || node.namedChildren.find((c) => c.type === "word");
      if (nameNode) symbols.set(nameNode.text, "function");
      return; // nested function's own body gets its own symbol scope
    }
    if (node.type === "variable_assignment") {
      const nameNode = node.childForFieldName("name");
      const valueNode = node.childForFieldName("value");
      if (nameNode) symbols.set(nameNode.text, literalRole(valueNode ? valueNode.text : ""));
    }
    if (node.type === "for_statement") {
      const varNode = node.childForFieldName("variable");
      if (varNode) symbols.set(varNode.text, "loop-item");
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
    case "function_definition": {
      const nameNode = node.childForFieldName("name") || node.namedChildren.find((c) => c.type === "word");
      return `Defines the function \`${nameNode ? nameNode.text : "?"}\`.`;
    }

    case "for_statement": {
      const varNode = node.childForFieldName("variable");
      // The iterable list has no single field name — it's every
      // named child besides the loop variable and the do-group body.
      const body = node.childForFieldName("body");
      const items = node.namedChildren
        .filter((c) => c !== varNode && c !== body)
        .map((c) => c.text)
        .join(" ");
      return `Iterates over \`${items}\`; on each pass, \`${varNode ? varNode.text : "?"}\` represents the current item.`;
    }

    case "while_statement":
      return "Starts a while loop that keeps running while its condition stays true.";

    case "if_statement": {
      const isElif = node.parent && (node.parent.type === "elif_clause" || node.parent.type === "if_statement");
      const conditionNode = node.childForFieldName("condition");
      const condition = conditionNode ? conditionNode.text : "?";
      return isElif
        ? `Checks another condition (${mdCode(condition)}) when the previous one was not met.`
        : `Checks whether ${mdCode(condition)} is true before running the code that follows.`;
    }

    case "elif_clause": {
      const conditionNode = node.childForFieldName("condition") || node.namedChildren[0];
      return `Checks another condition (${mdCode(conditionNode ? conditionNode.text : "?")}) when the previous one was not met.`;
    }

    case "else_clause":
      return "Defines the alternative block that runs when the previous condition is false.";

    case "variable_assignment": {
      const nameNode = node.childForFieldName("name");
      const valueNode = node.childForFieldName("value");
      if (!nameNode) return null;
      return `Sets the variable \`${nameNode.text}\` to \`${valueNode ? valueNode.text : ""}\`.`;
    }

    case "command": {
      const name = commandName(node);
      const args = commandArgs(node);

      if (name === "echo") {
        const varMatch = args.match(/^"?\$\{?([A-Za-z_]\w*)\}?"?$/);
        if (varMatch && symbols.has(varMatch[1])) {
          const role = symbols.get(varMatch[1]);
          const describe = role === "loop-item" ? `the current item, \`${varMatch[1]}\`` : `\`${varMatch[1]}\``;
          return `Prints ${describe} to the terminal.`;
        }
        return `Prints \`${args}\` to the terminal.`;
      }

      if (name === "source" || name === ".") {
        return "Loads another script's variables/functions into the current shell session.";
      }

      if (isReturnCommand(node)) {
        return args ? `Returns \`${args}\` from the current function.` : "Returns control from the current function.";
      }

      const role = symbols.get(name);
      const nameLabel = role === "function" ? `the \`${name}\` function` : `the \`${name}\` command`;
      return args ? `Runs ${nameLabel}, passing \`${args}\`.` : `Runs ${nameLabel}.`;
    }

    case "return_statement": {
      const value = node.namedChildren[0];
      return value ? `Returns \`${value.text}\` from the current function.` : "Returns control from the current function.";
    }

    default:
      return null;
  }
}

// ------------------------------------------------------------
// Issue checks
// ------------------------------------------------------------

const SUPERSEDED_MESSAGES = new Set([
  "This line comes right after a `return` in the same block, so it can never be reached.",
]);

function checkIssues(node, issues) {
  if (isReturnCommand(node)) {
    const next = node.nextNamedSibling;
    if (next && next.type !== "comment") {
      issues.push({
        line: lineOf(next),
        type: "warning",
        message: "This line comes right after a `return` in the same block, so it can never be reached.",
      });
    }
  }
}

// These four checks are inherently line-text based (not tied to any
// particular AST shape) and were part of the old regex analyzer's
// findIssues() — carried over unchanged rather than reimplemented
// against nodes, since text patterns are the natural fit here and
// security.test.js exercises two of them directly.
function checkTextIssues(lines, issues) {
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/rm\s+-rf\s+\//.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "This deletes files recursively from a root/broad path — double-check the target before running." });
    }
    if (/\beval\b/.test(line) && /\$/.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "`eval` re-parses and executes its argument as shell code. If it includes a variable that can be influenced by user/external input, this is a code-injection risk." });
    }
    if (/\b(curl|wget)\b.*\|\s*(sudo\s+)?(sh|bash)\b/.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "Piping a download straight into a shell runs whatever that remote server returns, with no chance to review it first. Download and inspect the script before running it." });
    }
    if (/\$\w+/.test(line) && !/"\$/.test(line) && /\brm\b|\bcp\b|\bmv\b/.test(line)) {
      issues.push({ line: index + 1, type: "review", message: "An unquoted variable is used with a file-affecting command. Quoting (`\"$var\"`) avoids issues with spaces or globbing." });
    }
  });
}

// ------------------------------------------------------------
// Structure
// ------------------------------------------------------------

function updateStructure(node, structure) {
  const lineNumber = lineOf(node);

  if (node.type === "comment") {
    structure.comments.push(lineNumber);
  } else if (node.type === "function_definition") {
    const nameNode = node.childForFieldName("name") || node.namedChildren.find((c) => c.type === "word");
    structure.functions.push({ line: lineNumber, name: nameNode ? nameNode.text : "?", parameters: "" });
  } else if (node.type === "variable_assignment") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) structure.variables.push({ line: lineNumber, name: nameNode.text });
  } else if (node.type === "for_statement" || node.type === "while_statement") {
    structure.loops.push(lineNumber);
  } else if (node.type === "if_statement" || node.type === "elif_clause" || node.type === "else_clause") {
    structure.conditionals.push(lineNumber);
  } else if (isReturnCommand(node) || node.type === "return_statement") {
    structure.returns.push(lineNumber);
  } else if (node.type === "command" && commandName(node) === "echo") {
    structure.outputs.push(lineNumber);
  } else if (node.type === "command" && (commandName(node) === "source" || commandName(node) === ".")) {
    structure.imports.push(lineNumber);
  }
}

// ------------------------------------------------------------
// Single entry point
// ------------------------------------------------------------

export async function analyzeAst(code) {
  await ensureReady();

  const parser = new Parser();
  parser.setLanguage(BashLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;

  const structure = {
    functions: [], classes: [], imports: [], variables: [],
    loops: [], conditionals: [], returns: [], outputs: [], comments: [],
  };
  const issues = findCommonIssues(code.split("\n")).filter((issue) => !SUPERSEDED_MESSAGES.has(issue.message));
  checkTextIssues(code.split("\n"), issues);
  const lineExplanations = [];

  function walk(node, symbols) {
    updateStructure(node, structure);
    checkIssues(node, issues);

    if (node.type === "function_definition") {
      const explanation = explainNode(node, symbols);
      if (explanation) lineExplanations.push({ line: lineOf(node), text: explanation });
      const body = node.childForFieldName("body");
      const localSymbols = buildSymbols(body);
      for (const [name, role] of symbols) if (!localSymbols.has(name)) localSymbols.set(name, role);
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
