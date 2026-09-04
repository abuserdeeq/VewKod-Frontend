// ============================================================
// Rust analyzer — Tree-sitter (AST) based
// ============================================================
// Same hybrid strategy as go.js/php.js/c.js: tree-sitter finds the
// *right lines*; the wording reuses the old regex-based analyzer's
// matchers almost verbatim, run against just that one line's source
// text. Unlike go.js, no per-function symbol table is needed here —
// nothing in this project's test suite exercises role-aware `if`
// phrasing for Rust, so it keeps the simpler generic wording the
// old analyzer already used for that case.

import Parser from "web-tree-sitter";
import { findCommonIssues } from "../shared/patterns.js";

export const id = "rust";
export const label = "Rust";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

const WASM_CORE_PATH = isNode
  ? "./node_modules/web-tree-sitter/tree-sitter.wasm"
  : "/wasm/tree-sitter.wasm";
const WASM_RUST_PATH = isNode
  ? "./node_modules/tree-sitter-wasms/out/tree-sitter-rust.wasm"
  : "/wasm/tree-sitter-rust.wasm";

export function detect(code) {
  return /\bfn\s+main\s*\(\s*\)/.test(code) || /\blet\s+mut\b/.test(code) || /\bprintln!\s*\(/.test(code);
}

let RustLang = null;
let ready = false;

async function ensureReady() {
  if (ready) return;
  await Parser.init(isNode ? undefined : { locateFile: () => WASM_CORE_PATH });
  RustLang = await Parser.Language.load(WASM_RUST_PATH);
  ready = true;
}

function lineOf(node) {
  return node.startPosition.row + 1;
}

// ------------------------------------------------------------
// Per-line explanation — ported near-verbatim from the old
// regex-based rust.js.
// ------------------------------------------------------------

function explainRustLine(rawLine) {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  if (/^use\s+[\w:]+;/.test(trimmed)) return "Brings another module/crate's items into scope.";

  const innerAttr = trimmed.match(/^#!\[(.+)\]$/);
  if (innerAttr) return `Applies the \`#![${innerAttr[1]}]\` attribute to the whole containing module/crate (an inner attribute — note the \`!\`).`;
  const outerAttr = trimmed.match(/^#\[(.+)\]$/);
  if (outerAttr) return `Applies the \`#[${outerAttr[1]}]\` attribute to the item defined on the next line (e.g. auto-implementing a trait, or configuring how it's tested/compiled).`;

  const structDecl = trimmed.match(/^(?:pub\s+)?struct\s+([A-Za-z_]\w*)/);
  if (structDecl) return `Defines the \`${structDecl[1]}\` struct, which can hold a group of related fields.`;

  const fn = trimmed.match(/^(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
  if (fn) {
    return fn[2].trim()
      ? `Defines the function \`${fn[1]}\`, which accepts \`${fn[2].trim()}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  const forLoop = trimmed.match(/^for\s+([A-Za-z_]\w*)\s+in\s+&?([A-Za-z_]\w*)/);
  if (forLoop) return `Iterates over \`${forLoop[2]}\`; on each pass, \`${forLoop[1]}\` represents the current item.`;
  if (/^loop\s*\{?$/.test(trimmed)) return "Starts an intentionally infinite loop, exited with `break` elsewhere.";
  if (/^while\s+/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";

  const ifLet = trimmed.match(/^if\s+let\s+(.+?)\s*=\s*(.+?)\s*\{?$/);
  if (ifLet) {
    const [, pattern, expr] = ifLet;
    return `If \`${expr.trim()}\` matches the \`${pattern.trim()}\` pattern, destructures it and runs the code that follows (Rust's \`if let\` — a shorthand for a \`match\` with only one case handled).`;
  }

  const ifMatch = trimmed.match(/^if\s+(.+?)\s*\{?$/);
  if (ifMatch) return `Checks whether \`${ifMatch[1].trim()}\` is true before running the code that follows.`;
  if (/^\}?\s*else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";
  if (/^match\s+/.test(trimmed)) return "Starts a match expression that picks a branch based on the value's pattern.";

  const matchArm = trimmed.match(/^(_|[A-Za-z_][\w:]*(?:\([^()]*\))?(?:\s*\|\s*[A-Za-z_][\w:]*(?:\([^()]*\))?)*)\s*(?:if\s+.+?)?=>\s*(.+?),?$/);
  if (matchArm) {
    const [, pattern, body] = matchArm;
    return `Matches the \`${pattern.trim()}\` pattern; if it matches, runs \`${body.trim()}\`.`;
  }

  const ret = trimmed.match(/^return\b\s*(.*?);?$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current function.` : "Returns control from the current function.";

  const print = trimmed.match(/\bprintln!\s*\((.*)\)\s*;?$/);
  if (print) return `Prints \`${print[1].trim()}\` to standard output, followed by a newline.`;

  const decl = trimmed.match(/^let\s+(mut\s+)?([A-Za-z_]\w*)\s*(?::\s*[\w<>]+)?\s*=\s*(.+);/);
  if (decl) return `Declares ${decl[1] ? "a mutable" : "an immutable"} binding \`${decl[2]}\` and assigns it \`${decl[3]}\`.`;

  const augMatch = trimmed.match(/^([A-Za-z_]\w*)\s*(\+=|-=|\*=|\/=|%=)\s*(.+?);?$/);
  if (augMatch) {
    const verbs = { "+=": ["Increases", "by"], "-=": ["Decreases", "by"], "*=": ["Multiplies", "by"], "/=": ["Divides", "by"], "%=": ["Takes the remainder (modulo) of", "by"] };
    const [verb, prep] = verbs[augMatch[2]] || ["Updates", "by"];
    return `${verb} the variable \`${augMatch[1]}\` ${prep} \`${augMatch[3].trim()}\`.`;
  }

  const bareCall = trimmed.match(/^([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*\(([^()]*)\)\s*;?$/);
  if (bareCall) {
    const args = bareCall[2].trim();
    return args ? `Calls \`${bareCall[1]}()\`, passing \`${args}\`.` : `Calls \`${bareCall[1]}()\` without passing any arguments.`;
  }

  // A line with no trailing `;` and not opening/closing a block is
  // very likely Rust's implicit-return expression (the value of the
  // last expression in a block is returned automatically).
  if (!trimmed.endsWith(";") && !trimmed.endsWith("{") && !trimmed.endsWith("}") && trimmed !== "}") {
    return `Evaluates \`${trimmed}\` as the value returned from this block (Rust's implicit-return syntax — no \`return\` keyword needed).`;
  }

  return null;
}

function checkRustLineIssues(rawLine, lineNumber, issues) {
  const line = rawLine.trim();
  if (/\.unwrap\s*\(\s*\)/.test(line)) {
    issues.push({ line: lineNumber, type: "warning", message: "`.unwrap()` panics if the value is `None`/`Err`. Consider handling the error case explicitly." });
  }
  if (/\bCommand::new\s*\(\s*"(sh|bash)"\s*\)/.test(line)) {
    issues.push({ line: lineNumber, type: "security", message: "Invoking a shell via `Command::new(\"sh\")`/`\"bash\"` with a built command string is a command-injection risk if any part comes from user input. Prefer running the target program directly with `.arg()` per argument." });
  }
  if (/^\s*unsafe\s*\{/.test(rawLine) || /^\s*unsafe\s+fn\b/.test(line)) {
    issues.push({ line: lineNumber, type: "review", message: "This `unsafe` block/function opts out of Rust's memory-safety guarantees. Double-check the invariants it relies on are actually upheld." });
  }
}

// ------------------------------------------------------------
// Structure
// ------------------------------------------------------------

function updateRustStructure(node, rawLine, structure) {
  const lineNumber = lineOf(node);
  const trimmed = rawLine.trim();

  if (node.type === "line_comment" || node.type === "block_comment") {
    structure.comments.push(lineNumber);
    return;
  }
  if (/^use\s+[\w:]+;/.test(trimmed)) {
    structure.imports.push(lineNumber);
  } else if (node.type === "function_item") {
    const fn = trimmed.match(/^(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) structure.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });
  } else if (node.type === "struct_item") {
    const structDecl = trimmed.match(/^(?:pub\s+)?struct\s+([A-Za-z_]\w*)/);
    if (structDecl) structure.classes.push({ line: lineNumber, name: structDecl[1] });
  } else if (node.type === "let_declaration") {
    const decl = trimmed.match(/^let\s+(?:mut\s+)?([A-Za-z_]\w*)/);
    if (decl) structure.variables.push({ line: lineNumber, name: decl[1] });
  } else if (["for_expression", "loop_expression", "while_expression"].includes(node.type)) {
    structure.loops.push(lineNumber);
  } else if (["if_expression", "match_expression"].includes(node.type)) {
    structure.conditionals.push(lineNumber);
  } else if (node.type === "return_expression") {
    structure.returns.push(lineNumber);
  } else if (/\bprintln!\s*\(/.test(trimmed)) {
    structure.outputs.push(lineNumber);
  }
}

// ------------------------------------------------------------
// Single entry point
// ------------------------------------------------------------

export async function analyzeAst(code) {
  await ensureReady();

  const parser = new Parser();
  parser.setLanguage(RustLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  const lines = code.split("\n");

  const structure = {
    functions: [], classes: [], imports: [], variables: [],
    loops: [], conditionals: [], returns: [], outputs: [], comments: [],
  };
  const issues = findCommonIssues(lines);
  const lineExplanations = [];
  const explainedLines = new Set();
  const issueCheckedLines = new Set();

  function walk(node) {
    const lineNumber = lineOf(node);
    const rawLine = lines[lineNumber - 1] || "";

    updateRustStructure(node, rawLine, structure);
    if (!issueCheckedLines.has(lineNumber)) {
      checkRustLineIssues(rawLine, lineNumber, issues);
      issueCheckedLines.add(lineNumber);
    }
    if (!explainedLines.has(lineNumber)) {
      const text = explainRustLine(rawLine);
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
