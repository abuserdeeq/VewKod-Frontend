// ============================================================
// C analyzer — Tree-sitter (AST) based
// ============================================================
// Same hybrid strategy as php.js: tree-sitter finds the *right
// lines* (real statement/declaration boundaries, immune to string/
// comment false positives that plagued the old regex scanner) but
// the actual wording reuses the old regex-based analyzer's matchers
// almost verbatim, run against just that one line's source text.
// See php.js's header comment for the fuller rationale.
//
// cpp.js builds on top of this file the same way typescript.js
// builds on javascript.js — C++ is a near-superset of C at the
// text/regex level (same declaration/loop/if syntax), so its own
// explainer tries the C++-specific patterns first and falls back to
// this file's for everything else.

import Parser from "web-tree-sitter";
import {
  isCommentLineExcludingHash as isCommentLine,
  commentExplanation,
  findCommonIssues,
  explainAugmentedAssignment,
  explainIncrementDecrement,
  explainTernary,
  explainClassicForLoop,
  explainBareFunctionCall,
} from "../shared/patterns.js";

export const id = "c";
export const label = "C";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

const WASM_CORE_PATH = isNode
  ? "./node_modules/web-tree-sitter/tree-sitter.wasm"
  : "/wasm/tree-sitter.wasm";
const WASM_C_PATH = isNode
  ? "./node_modules/tree-sitter-wasms/out/tree-sitter-c.wasm"
  : "/wasm/tree-sitter-c.wasm";

export function detect(code) {
  return /#include\s*<.*\.h>/.test(code) || /\bprintf\s*\(/.test(code) || /#include\s*<stdio\.h>/.test(code);
}

let CLang = null;
let ready = false;

async function ensureReady() {
  if (ready) return;
  await Parser.init(isNode ? undefined : { locateFile: () => WASM_CORE_PATH });
  CLang = await Parser.Language.load(WASM_C_PATH);
  ready = true;
}

export function lineOf(node) {
  return node.startPosition.row + 1;
}

// A multi-word C type: `struct Node *`, `unsigned long`, `const char *`.
export const TYPE = "(?:const\\s+)?(?:struct\\s+[A-Za-z_]\\w*|unsigned\\s+\\w+|[A-Za-z_]\\w*)";

// ------------------------------------------------------------
// Per-line explanation — ported near-verbatim from the old
// regex-based c.js.
// ------------------------------------------------------------

export function explainCLine(rawLine) {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  if (/^#include\s*<(.+)>/.test(trimmed)) {
    const m = trimmed.match(/^#include\s*<(.+)>/);
    return `Includes the \`${m[1]}\` header, giving access to its functions/macros.`;
  }

  const structDecl = trimmed.match(/^struct\s+([A-Za-z_]\w*)\s*\{?$/);
  if (structDecl) return `Defines the \`${structDecl[1]}\` struct, which can hold a group of related fields.`;

  const fn = trimmed.match(new RegExp(`^(?:static\\s+)?${TYPE}\\s*\\*?\\s*([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)\\s*\\{?$`));
  if (fn && !/\b(if|for|while|switch|return)\b/.test(trimmed)) {
    return fn[2].trim()
      ? `Defines the function \`${fn[1]}\`, which accepts \`${fn[2].trim()}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  if (/^for\s*\(/.test(trimmed)) return explainClassicForLoop(trimmed) || "Starts a counted loop that repeats a block of code a set number of times.";
  if (/^while\s*\(/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";

  const ifMatch = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
  if (ifMatch) return `Checks whether \`${ifMatch[1].trim()}\` is true before running the code that follows.`;
  if (/^else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";

  const ret = trimmed.match(/^return\b\s*(.*?);?$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current function.` : "Returns control from the current function.";

  const printf = trimmed.match(/\bprintf\s*\((.*)\)\s*;?$/);
  if (printf) return `Formats and prints \`${printf[1].trim()}\` to standard output.`;

  const mallocMatch = trimmed.match(/^(?:const\s+)?(?:struct\s+[A-Za-z_]\w*|[A-Za-z_]\w*)\s*\*\s*([A-Za-z_]\w*)\s*=\s*\(?[\w\s*]*\)?\s*(?:m|c)alloc\s*\((.+)\)\s*;$/);
  if (mallocMatch) return `Declares the pointer \`${mallocMatch[1]}\` and allocates memory for it on the heap (\`${trimmed.includes("calloc") ? "calloc" : "malloc"}(${mallocMatch[2].trim()})\`) — this memory must later be released with \`free(${mallocMatch[1]})\`, or it leaks.`;

  const pointer = trimmed.match(new RegExp(`^${TYPE}\\s*\\*\\s*([A-Za-z_]\\w*)\\s*=\\s*(.+);`));
  if (pointer) return `Declares the pointer \`${pointer[1]}\` and points it at \`${pointer[2]}\`.`;

  const arrowAssign = trimmed.match(/^([A-Za-z_]\w*)->([A-Za-z_]\w*)\s*=\s*(.+);$/);
  if (arrowAssign) return `Sets the \`${arrowAssign[2]}\` field of the struct that \`${arrowAssign[1]}\` points to, to \`${arrowAssign[3].trim()}\`.`;

  const decl = trimmed.match(/^(int|char|float|double|long|short)\s+([A-Za-z_]\w*)\s*=\s*(.+);/);
  if (decl) {
    const ternary = explainTernary(decl[2], decl[3]);
    if (ternary) return ternary;
    return `Declares a \`${decl[1]}\` variable \`${decl[2]}\` and assigns it \`${decl[3]}\`.`;
  }

  const reassign = trimmed.match(/^([A-Za-z_]\w*)\s*=\s*(.+);$/);
  if (reassign) return `Sets \`${reassign[1]}\` to \`${reassign[2].trim()}\`.`;

  const bareDecl = trimmed.match(new RegExp(`^${TYPE}\\s*(\\*)?\\s*([A-Za-z_]\\w*)\\s*;$`));
  if (bareDecl) {
    const [, star, name] = bareDecl;
    return star
      ? `Declares the pointer \`${name}\` (not yet initialized/assigned).`
      : `Declares the variable \`${name}\` (not yet initialized/assigned).`;
  }

  const incDec = explainIncrementDecrement(trimmed);
  if (incDec) return incDec;

  const augmented = explainAugmentedAssignment(trimmed, { knownIdentifiersIn: () => [], describe: (n) => `\`${n}\`` }, "global");
  if (augmented) return augmented;

  const bareCall = explainBareFunctionCall(trimmed, { knownIdentifiersIn: () => [], describe: (n) => `\`${n}\``, get: () => null }, "global");
  if (bareCall) return bareCall;

  return null;
}

// ------------------------------------------------------------
// Issue checks
// ------------------------------------------------------------

export function checkCLineIssues(rawLine, lineNumber, issues) {
  const line = rawLine.trim();
  if (/\bgets\s*\(/.test(line)) {
    issues.push({ line: lineNumber, type: "security", message: "`gets()` cannot bound how much input it reads and is unsafe; use `fgets()` instead." });
  }
  if (/\bstrcpy\s*\(/.test(line)) {
    issues.push({ line: lineNumber, type: "security", message: "`strcpy()` does not check buffer size and can overflow; consider `strncpy()`." });
  }
  if (/\bsprintf\s*\(/.test(line)) {
    issues.push({ line: lineNumber, type: "security", message: "`sprintf()` writes without checking buffer size and can overflow; use `snprintf()` with an explicit size instead." });
  }
  const systemCall = line.match(/\bsystem\s*\((.+)\)\s*;?$/);
  if (systemCall && !/^".*"$/.test(systemCall[1].trim())) {
    issues.push({ line: lineNumber, type: "security", message: "`system()` is called with a non-literal argument. If any part comes from user input, this is a command-injection risk." });
  }
}

export function checkMallocFree(lines, issues) {
  const mallocLines = [];
  let hasFree = false;
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/\bmalloc\s*\(/.test(line) || /\bcalloc\s*\(/.test(line)) mallocLines.push(index + 1);
    if (/\bfree\s*\(/.test(line)) hasFree = true;
  });
  if (mallocLines.length && !hasFree) {
    mallocLines.forEach((line) =>
      issues.push({ line, type: "warning", message: "Memory allocated here (`malloc`/`calloc`) doesn't appear to be released with a matching `free()` anywhere in this snippet." })
    );
  }
}

// ------------------------------------------------------------
// Structure
// ------------------------------------------------------------

export function updateCStructure(node, rawLine, structure) {
  const lineNumber = lineOf(node);
  const trimmed = rawLine.trim();

  if (node.type === "comment") {
    structure.comments.push(lineNumber);
    return;
  }
  if (/^#include\b/.test(trimmed)) {
    structure.imports.push(lineNumber);
  } else if (node.type === "function_definition") {
    const fn = trimmed.match(new RegExp(`^(?:static\\s+)?${TYPE}\\s*\\*?\\s*([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)`));
    if (fn) structure.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });
  } else if (node.type === "struct_specifier") {
    const cls = trimmed.match(/\bstruct\s+([A-Za-z_]\w*)/);
    if (cls) structure.classes.push({ line: lineNumber, name: cls[1] });
  } else if (node.type === "declaration" || node.type === "init_declarator") {
    const decl = trimmed.match(/^(?:int|char|float|double|long|short)\s+([A-Za-z_]\w*)/);
    if (decl) structure.variables.push({ line: lineNumber, name: decl[1] });
  } else if (node.type === "for_statement" || node.type === "while_statement") {
    structure.loops.push(lineNumber);
  } else if (node.type === "if_statement") {
    structure.conditionals.push(lineNumber);
  } else if (node.type === "return_statement") {
    structure.returns.push(lineNumber);
  } else if (/\bprintf\s*\(/.test(trimmed)) {
    structure.outputs.push(lineNumber);
  }
}

// ------------------------------------------------------------
// Single entry point
// ------------------------------------------------------------

export async function analyzeAst(code) {
  await ensureReady();

  const parser = new Parser();
  parser.setLanguage(CLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  const lines = code.split("\n");

  const structure = {
    functions: [], classes: [], imports: [], variables: [],
    loops: [], conditionals: [], returns: [], outputs: [], comments: [],
  };
  const issues = findCommonIssues(lines);
  checkMallocFree(lines, issues);

  const lineExplanations = [];
  const explainedLines = new Set();
  const issueCheckedLines = new Set();

  function walk(node) {
    const lineNumber = lineOf(node);
    const rawLine = lines[lineNumber - 1] || "";

    updateCStructure(node, rawLine, structure);
    if (!issueCheckedLines.has(lineNumber)) {
      checkCLineIssues(rawLine, lineNumber, issues);
      issueCheckedLines.add(lineNumber);
    }
    if (!explainedLines.has(lineNumber)) {
      const text = explainCLine(rawLine);
      if (text) {
        lineExplanations.push({ line: lineNumber, text });
        explainedLines.add(lineNumber);
      }
    }

    for (const child of node.namedChildren) walk(child);
  }

  walk(root);
  lineExplanations.sort((a, b) => a.line - b.line);

  return { structure, issues, lineExplanations };
}
