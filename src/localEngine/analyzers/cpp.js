// ============================================================
// C++ analyzer — Tree-sitter (AST) based
// ============================================================
// Builds on c.js the way typescript.js builds on javascript.js: C++
// is a near-superset of C at the level this analyzer cares about
// (declarations, loops, if/else, functions all look the same), so
// this file only implements what's genuinely different — classes,
// std:: containers, cout/cerr, try/catch, range-based for, new/
// delete — and falls back to c.js's line explainer/issue checker for
// everything else instead of duplicating it.

import Parser from "web-tree-sitter";
import {
  isCommentLineExcludingHash as isCommentLine,
  commentExplanation,
  findCommonIssues,
  explainAugmentedAssignment,
  explainIncrementDecrement,
  explainTernary,
  explainClassicForLoop,
  explainBraceTryCatch,
  explainBareFunctionCall,
} from "../shared/patterns.js";
import { explainCLine, checkCLineIssues, checkMallocFree, lineOf } from "./c.js";

export const id = "cpp";
export const label = "C++";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

const WASM_CORE_PATH = isNode
  ? "./node_modules/web-tree-sitter/tree-sitter.wasm"
  : "/wasm/tree-sitter.wasm";
const WASM_CPP_PATH = isNode
  ? "./node_modules/tree-sitter-wasms/out/tree-sitter-cpp.wasm"
  : "/wasm/tree-sitter-cpp.wasm";

export function detect(code) {
  return /\b(std::|cout|cin|vector<|namespace)\b/.test(code) || /#include\s*<(iostream|vector|string|map)>/.test(code);
}

let CppLang = null;
let ready = false;

async function ensureReady() {
  if (ready) return;
  await Parser.init(isNode ? undefined : { locateFile: () => WASM_CORE_PATH });
  CppLang = await Parser.Language.load(WASM_CPP_PATH);
  ready = true;
}

const CPP_TYPE = "(?:const\\s+)?(?:struct\\s+[A-Za-z_]\\w*|unsigned\\s+\\w+|[\\w:<>]+)";

function explainCppLine(rawLine) {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  const include = trimmed.match(/^#include\s*<(.+)>/);
  if (include) return `Includes the \`${include[1]}\` standard library header.`;

  const cls = trimmed.match(/\bclass\s+([A-Za-z_]\w*)/);
  if (cls) return `Defines the class \`${cls[1]}\`, which can serve as a blueprint for creating objects.`;

  const fn = trimmed.match(new RegExp(`^(?:static\\s+)?${CPP_TYPE}\\s*&?\\s*([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)\\s*\\{?$`));
  if (fn && !/\b(if|for|while|switch|return|catch)\b/.test(trimmed)) {
    return fn[2].trim()
      ? `Defines the function \`${fn[1]}\`, which accepts \`${fn[2].trim()}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  const forRange = trimmed.match(/^for\s*\(\s*(?:auto|[\w:<>]+)\s*&?\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)\s*\)/);
  if (forRange) {
    return `Iterates over \`${forRange[2]}\`; on each pass, \`${forRange[1]}\` represents the current item.`;
  }

  if (/^for\s*\(/.test(trimmed)) return explainClassicForLoop(trimmed) || "Starts a counted loop that repeats a block of code a set number of times.";
  if (/^while\s*\(/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";

  const ifMatch = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
  if (ifMatch) return `Checks whether \`${ifMatch[1].trim()}\` is true before running the code that follows.`;
  if (/^else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";

  const ret = trimmed.match(/^return\b\s*(.*?);?$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current function.` : "Returns control from the current function.";

  const cout = trimmed.match(/\b(cout|cerr)\s*<<\s*(.+?)\s*(?:<<\s*endl)?\s*;?$/);
  if (cout) {
    const stream = cout[1] === "cerr" ? "standard error" : "standard output";
    return `Sends \`${cout[2].trim()}\` to ${stream}.`;
  }

  const vec = trimmed.match(/(?:std::)?vector\s*<[^>]*>\s*&?\s*([A-Za-z_]\w*)\s*=\s*(.+);/);
  if (vec) return `Creates the vector \`${vec[1]}\` and initializes it with \`${vec[2]}\`.`;

  const decl = trimmed.match(/^(int|double|float|char|bool|string|std::string)\s+([A-Za-z_]\w*)\s*=\s*(.+);/);
  if (decl) {
    const ternary = explainTernary(decl[2], decl[3]);
    if (ternary) return ternary;
    return `Declares a \`${decl[1]}\` variable \`${decl[2]}\` and assigns it \`${decl[3]}\`.`;
  }

  const incDec = explainIncrementDecrement(trimmed);
  if (incDec) return incDec;

  const augmented = explainAugmentedAssignment(trimmed, { knownIdentifiersIn: () => [], describe: (n) => `\`${n}\`` }, "global");
  if (augmented) return augmented;

  const tryCatch = explainBraceTryCatch(trimmed);
  if (tryCatch) return tryCatch;

  const bareCall = explainBareFunctionCall(trimmed, { knownIdentifiersIn: () => [], describe: (n) => `\`${n}\``, get: () => null }, "global");
  if (bareCall) return bareCall;

  // Not a C++-specific pattern — fall back to C's explainer (plain
  // declarations, pointers, structs, malloc/free, printf, etc. are
  // all identical between the two languages).
  return explainCLine(rawLine);
}

function checkCppLineIssues(rawLine, lineNumber, issues) {
  const line = rawLine.trim();
  if (/\busing\s+namespace\s+std\s*;/.test(line)) {
    issues.push({ line: lineNumber, type: "review", message: "`using namespace std;` at file/global scope can cause naming conflicts in larger projects." });
  }
  const systemCall = line.match(/\bsystem\s*\((.+)\)\s*;?$/);
  if (systemCall && !/^".*"$/.test(systemCall[1].trim())) {
    issues.push({ line: lineNumber, type: "security", message: "`system()` is called with a non-literal argument. If any part comes from user input, this is a command-injection risk." });
  }
  // sprintf and the rest of the plain-C danger list apply equally to C++.
  checkCLineIssues(rawLine, lineNumber, issues);
}

function checkNewDelete(lines, issues) {
  let hasNew = 0;
  let hasDelete = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/\bnew\s+\w+/.test(line)) hasNew++;
    if (/\bdelete\b/.test(line)) hasDelete++;
  }
  if (hasNew > hasDelete) {
    issues.push({ line: 1, type: "warning", message: "There are more `new` allocations than `delete` calls in this snippet — check for a possible memory leak (or consider smart pointers)." });
  }
}

function updateCppStructure(node, rawLine, structure) {
  const lineNumber = lineOf(node);
  const trimmed = rawLine.trim();

  if (node.type === "comment") {
    structure.comments.push(lineNumber);
    return;
  }
  if (/^#include\b/.test(trimmed)) {
    structure.imports.push(lineNumber);
  } else if (node.type === "class_specifier") {
    const cls = trimmed.match(/\bclass\s+([A-Za-z_]\w*)/);
    if (cls) structure.classes.push({ line: lineNumber, name: cls[1] });
  } else if (node.type === "function_definition") {
    const fn = trimmed.match(new RegExp(`^(?:static\\s+)?${CPP_TYPE}\\s*&?\\s*([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)`));
    if (fn) structure.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });
  } else if (node.type === "for_statement" || node.type === "for_range_loop" || node.type === "while_statement") {
    structure.loops.push(lineNumber);
  } else if (node.type === "if_statement") {
    structure.conditionals.push(lineNumber);
  } else if (node.type === "return_statement") {
    structure.returns.push(lineNumber);
  } else if (/\bcout\s*<</.test(trimmed)) {
    structure.outputs.push(lineNumber);
  } else if (node.type === "declaration" || node.type === "init_declarator") {
    const decl = trimmed.match(/^(?:int|double|float|char|bool|string|std::string)\s+([A-Za-z_]\w*)/);
    if (decl) structure.variables.push({ line: lineNumber, name: decl[1] });
  }
}

export async function analyzeAst(code) {
  await ensureReady();

  const parser = new Parser();
  parser.setLanguage(CppLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  const lines = code.split("\n");

  const structure = {
    functions: [], classes: [], imports: [], variables: [],
    loops: [], conditionals: [], returns: [], outputs: [], comments: [],
  };
  const issues = findCommonIssues(lines);
  checkMallocFree(lines, issues);
  checkNewDelete(lines, issues);

  const lineExplanations = [];
  const explainedLines = new Set();
  const issueCheckedLines = new Set();

  function walk(node) {
    const lineNumber = lineOf(node);
    const rawLine = lines[lineNumber - 1] || "";

    updateCppStructure(node, rawLine, structure);
    if (!issueCheckedLines.has(lineNumber)) {
      checkCppLineIssues(rawLine, lineNumber, issues);
      issueCheckedLines.add(lineNumber);
    }
    if (!explainedLines.has(lineNumber)) {
      const text = explainCppLine(rawLine);
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
