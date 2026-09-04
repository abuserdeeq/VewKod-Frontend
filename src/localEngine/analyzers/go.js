// ============================================================
// Go analyzer — Tree-sitter (AST) based
// ============================================================
// Same hybrid strategy as php.js/c.js: tree-sitter finds the *right
// lines* and real function boundaries; the wording reuses the old
// regex-based analyzer's matchers almost verbatim, run against just
// that one line's source text.
//
// One addition over the plain-hybrid approach (php.js/c.js): a
// function's `if x { }` needs to know whether `x` is a slice, a
// number, etc. to phrase things like "the `x` list" rather than a
// bland "checks whether `x` is true" — so each function's own lines
// get a small scoped symbol map built from them (mirroring the old
// buildSymbolTable(), just scoped by the AST's real function
// boundaries instead of a hand-rolled brace-counting heuristic).

import Parser from "web-tree-sitter";
import { findCommonIssues } from "../shared/patterns.js";

export const id = "go";
export const label = "Go";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

const WASM_CORE_PATH = isNode
  ? "./node_modules/web-tree-sitter/tree-sitter.wasm"
  : "/wasm/tree-sitter.wasm";
const WASM_GO_PATH = isNode
  ? "./node_modules/tree-sitter-wasms/out/tree-sitter-go.wasm"
  : "/wasm/tree-sitter-go.wasm";

export function detect(code) {
  return /^\s*package\s+\w+/m.test(code) || /\bfunc\s+main\s*\(\s*\)/.test(code) || /\bfmt\.(Println|Printf|Print)\s*\(/.test(code);
}

let GoLang = null;
let ready = false;

async function ensureReady() {
  if (ready) return;
  await Parser.init(isNode ? undefined : { locateFile: () => WASM_CORE_PATH });
  GoLang = await Parser.Language.load(WASM_GO_PATH);
  ready = true;
}

function lineOf(node) {
  return node.startPosition.row + 1;
}

function literalRole(value) {
  const v = value.trim();
  if (/^\[\]/.test(v)) return "list";
  if (/^map\[/.test(v)) return "dict";
  if (/^".*"$/.test(v)) return "string";
  if (/^(true|false)$/.test(v)) return "boolean";
  if (/^-?\d+(\.\d+)?$/.test(v)) return "number";
  return "variable";
}

function describeRole(name, role) {
  switch (role) {
    case "list": return `the \`${name}\` list`;
    case "dict": return `the \`${name}\` map`;
    case "number": return `the number stored in \`${name}\``;
    case "string": return `the string stored in \`${name}\``;
    case "boolean": return `the boolean \`${name}\``;
    case "loop-item": return `the current item (\`${name}\`)`;
    default: return null;
  }
}

// Scans just one function's own line range (from the AST's real
// boundaries) for `:=`/`var`/range-loop declarations — same shape
// the old buildSymbolTable() matched, just scoped per-function so
// two functions' identically-named variables never mix.
function buildGoSymbols(lines, startRow, endRow) {
  const symbols = new Map();
  for (let i = startRow; i <= endRow && i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const shortDecl = line.match(/^([A-Za-z_]\w*)\s*:=\s*(.+)$/);
    if (shortDecl) symbols.set(shortDecl[1], literalRole(shortDecl[2]));

    const varDecl = line.match(/^var\s+([A-Za-z_]\w*)\s+(\[\]\w+|map\[\w+\]\w+|\w+)/);
    if (varDecl) {
      const t = varDecl[2];
      const role = t.startsWith("[]") ? "list" : t.startsWith("map[") ? "dict" : t === "string" ? "string" : t === "bool" ? "boolean" : "number";
      symbols.set(varDecl[1], role);
    }

    const rangeLoop = line.match(/^for\s+(?:([A-Za-z_]\w*)\s*,\s*)?([A-Za-z_]\w*)\s*:=\s*range\s+([A-Za-z_]\w*)/);
    if (rangeLoop) symbols.set(rangeLoop[2], "loop-item");
  }
  return symbols;
}

// ------------------------------------------------------------
// Per-line explanation — ported near-verbatim from the old
// regex-based go.js.
// ------------------------------------------------------------

function explainGoLine(rawLine, symbols) {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  if (/^package\s+\w+/.test(trimmed)) return "Declares which package this file belongs to.";
  if (/^import\b/.test(trimmed)) return "Starts an import block, bringing in other packages.";
  if (/^\s*"[\w/]+"\s*$/.test(trimmed)) return `Imports the \`${trimmed.replace(/"/g, "")}\` package.`;

  const typeDecl = trimmed.match(/^type\s+([A-Za-z_]\w*)\s+struct/);
  if (typeDecl) return `Defines the \`${typeDecl[1]}\` struct, which can hold a group of related fields.`;

  const fn = trimmed.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/);
  if (fn) {
    return fn[2].trim()
      ? `Defines the function \`${fn[1]}\`, which accepts \`${fn[2].trim()}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  const rangeLoop = trimmed.match(/^for\s+(?:([A-Za-z_]\w*)\s*,\s*)?([A-Za-z_]\w*)\s*:=\s*range\s+([A-Za-z_]\w*)/);
  if (rangeLoop) {
    const role = symbols.get(rangeLoop[3]);
    const phrase = role === "list" ? `the \`${rangeLoop[3]}\` slice` : `\`${rangeLoop[3]}\``;
    return `Iterates over ${phrase}; on each pass, \`${rangeLoop[2]}\` represents the current item.`;
  }
  if (/^for\b/.test(trimmed)) return "Starts a loop that repeats a block of code.";

  const ifMatch = trimmed.match(/^if\s+(.+?)\s*\{?$/);
  if (ifMatch) {
    const condition = ifMatch[1].trim();
    if (/^[A-Za-z_]\w*$/.test(condition)) {
      const described = describeRole(condition, symbols.get(condition));
      if (described) return `Checks whether ${described} meets the condition before running the code that follows.`;
    }
    return `Checks whether \`${condition}\` is true before running the code that follows.`;
  }
  if (/^\}?\s*else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";

  const deferMatch = trimmed.match(/^defer\s+(.+?);?$/);
  if (deferMatch) return `Schedules \`${deferMatch[1].trim()}\` to run right before the surrounding function returns, no matter how it returns (Go's \`defer\`) — commonly used for cleanup like closing a file or connection.`;

  const goStmt = trimmed.match(/^go\s+(.+?);?$/);
  if (goStmt) return `Starts \`${goStmt[1].trim()}\` running concurrently in a new goroutine, without waiting for it to finish.`;

  const panicMatch = trimmed.match(/^panic\s*\((.*)\)\s*;?$/);
  if (panicMatch) {
    return panicMatch[1].trim()
      ? `Panics with \`${panicMatch[1].trim()}\`, immediately stopping normal execution and unwinding the call stack (recoverable only via a deferred \`recover()\`).`
      : "Panics, immediately stopping normal execution and unwinding the call stack.";
  }

  if (/^(?:[A-Za-z_]\w*\s*:?=\s*)?recover\s*\(\s*\)\s*;?$/.test(trimmed)) {
    return "Recovers from a panic in progress in the current goroutine, if there is one, stopping the unwind and letting execution continue.";
  }

  const ret = trimmed.match(/^return\b\s*(.*)$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current function.` : "Returns control from the current function.";

  const print = trimmed.match(/\bfmt\.(Println|Printf|Print)\s*\((.*)\)\s*$/);
  if (print) return `Prints \`${print[2].trim()}\` to standard output.`;

  // multi-value short decl: result, err := someFunc(...)
  const multiDecl = trimmed.match(/^([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*:=\s*(.+)$/);
  if (multiDecl) {
    const [, first, second, callExpr] = multiDecl;
    return second === "err"
      ? `Calls \`${callExpr.trim()}\`, storing the result in \`${first}\` and any error in \`${second}\`.`
      : `Calls \`${callExpr.trim()}\`, assigning the results to \`${first}\` and \`${second}\`.`;
  }

  const shortDecl = trimmed.match(/^([A-Za-z_]\w*)\s*:=\s*(.+)$/);
  if (shortDecl) return `Declares and initializes \`${shortDecl[1]}\` with \`${shortDecl[2]}\` (type inferred by Go).`;

  const incDec = trimmed.match(/^([A-Za-z_]\w*)\s*(\+\+|--)\s*;?$/);
  if (incDec) return incDec[2] === "++" ? `Increments \`${incDec[1]}\` by 1.` : `Decrements \`${incDec[1]}\` by 1.`;

  const augMatch = trimmed.match(/^([A-Za-z_]\w*)\s*(\+=|-=|\*=|\/=|%=)\s*(.+?);?$/);
  if (augMatch) {
    const verbs = { "+=": ["Increases", "by"], "-=": ["Decreases", "by"], "*=": ["Multiplies", "by"], "/=": ["Divides", "by"], "%=": ["Takes the remainder (modulo) of", "by"] };
    const [verb, prep] = verbs[augMatch[2]] || ["Updates", "by"];
    return `${verb} the variable \`${augMatch[1]}\` ${prep} \`${augMatch[3].trim()}\`.`;
  }

  const bareCall = trimmed.match(/^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(([^()]*)\)\s*;?$/);
  if (bareCall) {
    const args = bareCall[2].trim();
    return args ? `Calls \`${bareCall[1]}()\`, passing \`${args}\`.` : `Calls \`${bareCall[1]}()\` without passing any arguments.`;
  }

  return null;
}

function checkGoLineIssues(lines, index, issues) {
  const line = lines[index].trim();
  if (/,\s*err\s*:=/.test(line) || /,\s*err\s*=/.test(line)) {
    const handledNearby = lines.slice(index, index + 3).some((l) => /\bif\s+err\s*!=\s*nil\b/.test(l));
    if (!handledNearby) {
      issues.push({ line: index + 1, type: "warning", message: "An `err` value is assigned here but doesn't appear to be checked with `if err != nil` right after." });
    }
  }
  if (/\bexec\.Command\s*\(/.test(line) && /"(sh|bash)"/.test(line) && /(\+|Sprintf)/.test(line)) {
    issues.push({ line: index + 1, type: "security", message: "`exec.Command` invokes a shell with a built command string. If any part comes from user input, this is a command-injection risk — pass the program and arguments separately instead of going through `sh -c`." });
  }
}

// ------------------------------------------------------------
// Structure
// ------------------------------------------------------------

function updateGoStructure(node, rawLine, structure) {
  const lineNumber = lineOf(node);
  const trimmed = rawLine.trim();

  if (node.type === "comment") {
    structure.comments.push(lineNumber);
    return;
  }
  if (/^import\b/.test(trimmed) || /^\s*"[\w/]+"\s*$/.test(trimmed)) {
    structure.imports.push(lineNumber);
  } else if (node.type === "function_declaration" || node.type === "method_declaration") {
    const fn = trimmed.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) structure.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });
  } else if (node.type === "type_declaration") {
    const typeDecl = trimmed.match(/^type\s+([A-Za-z_]\w*)\s+struct/);
    if (typeDecl) structure.classes.push({ line: lineNumber, name: typeDecl[1] });
  } else if (node.type === "short_var_declaration") {
    const shortDecl = trimmed.match(/^([A-Za-z_]\w*)\s*:=/);
    if (shortDecl) structure.variables.push({ line: lineNumber, name: shortDecl[1] });
  } else if (node.type === "for_statement") {
    structure.loops.push(lineNumber);
  } else if (node.type === "if_statement" || node.type === "expression_switch_statement") {
    structure.conditionals.push(lineNumber);
  } else if (node.type === "return_statement") {
    structure.returns.push(lineNumber);
  } else if (/\bfmt\.(Println|Printf|Print)\s*\(/.test(trimmed)) {
    structure.outputs.push(lineNumber);
  }
}

// ------------------------------------------------------------
// Single entry point
// ------------------------------------------------------------

export async function analyzeAst(code) {
  await ensureReady();

  const parser = new Parser();
  parser.setLanguage(GoLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  const lines = code.split("\n");

  const structure = {
    functions: [], classes: [], imports: [], variables: [],
    loops: [], conditionals: [], returns: [], outputs: [], comments: [],
  };
  const issues = findCommonIssues(lines);
  lines.forEach((_, index) => checkGoLineIssues(lines, index, issues));

  const lineExplanations = [];
  const explainedLines = new Set();
  const globalSymbols = new Map();

  function walk(node, symbols) {
    const lineNumber = lineOf(node);
    const rawLine = lines[lineNumber - 1] || "";

    updateGoStructure(node, rawLine, structure);

    if (!explainedLines.has(lineNumber)) {
      const text = explainGoLine(rawLine, symbols);
      if (text) {
        lineExplanations.push({ line: lineNumber, text });
        explainedLines.add(lineNumber);
      }
    }

    if (node.type === "function_declaration" || node.type === "method_declaration") {
      const scopedSymbols = buildGoSymbols(lines, node.startPosition.row, node.endPosition.row);
      for (const child of node.namedChildren) walk(child, scopedSymbols);
      return;
    }

    for (const child of node.namedChildren) walk(child, symbols);
  }

  walk(root, globalSymbols);
  lineExplanations.sort((a, b) => a.line - b.line);

  return { structure, issues, lineExplanations };
}
