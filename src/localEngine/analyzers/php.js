// ============================================================
// PHP analyzer — Tree-sitter (AST) based
// ============================================================
// Same overall architecture as javascript.js/python.js (single
// async analyzeAst(code) entry point), but with a deliberately
// hybrid strategy: tree-sitter is used to find the *right lines*
// (real statement boundaries, not text that merely looks like one
// inside a string/comment, and reliable block boundaries for the
// empty-catch/unreachable-return checks) — but the actual wording
// for each line reuses the old regex-based analyzer's matchers
// almost verbatim, run against just that one line's source text.
//
// This is safer than a fully field-based AST rewrite (like
// javascript.js) for a first pass: PHP's tree-sitter grammar field
// names are less exercised in this project so far, and getting a
// field name wrong silently produces `?` instead of a crash. Text
// extraction only needs the AST to point at the right line; the
// actual wording logic is the same one this project already shipped
// and tested for months as the regex analyzer.

import Parser from "web-tree-sitter";
import { findCommonIssues, mdCode, explainTernary, explainClassicForLoop } from "../shared/patterns.js";

export const id = "php";
export const label = "PHP";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

const WASM_CORE_PATH = isNode
  ? "./node_modules/web-tree-sitter/tree-sitter.wasm"
  : "/wasm/tree-sitter.wasm";
const WASM_PHP_PATH = isNode
  ? "./node_modules/tree-sitter-wasms/out/tree-sitter-php.wasm"
  : "/wasm/tree-sitter-php.wasm";

export function detect(code) {
  // Same heuristic as the old regex-based analyzer — require the PHP
  // tag, or a PHP-style function signature with a $-prefixed
  // parameter (avoids colliding with Bash, which also uses `$var` +
  // `echo` but never `function foo($x)`).
  return /<\?php/.test(code) || /function\s+\w+\s*\(\s*\$/.test(code);
}

let PHPLang = null;
let ready = false;

async function ensureReady() {
  if (ready) return;
  await Parser.init(isNode ? undefined : { locateFile: () => WASM_CORE_PATH });
  PHPLang = await Parser.Language.load(WASM_PHP_PATH);
  ready = true;
}

function lineOf(node, lineOffset = 0) {
  return node.startPosition.row + 1 - lineOffset;
}

// ------------------------------------------------------------
// Per-line explanation — ported near-verbatim from the old
// regex-based php.js, minus the symbol-table-driven phrasing (that
// caused the "(a array)" grammar-bug regression this project hit
// before; keeping this simpler is deliberate, not a missing feature).
// ------------------------------------------------------------

function explainPhpLine(rawLine) {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (trimmed === "<?php" || trimmed === "?>") return "Marks the boundary of a PHP code block.";

  if (/^(require|include)(_once)?\b/.test(trimmed)) {
    return "Includes another PHP file so its code/definitions become available here.";
  }

  const cls = trimmed.match(/\bclass\s+([A-Za-z_]\w*)/);
  if (cls) return `Defines the class \`${cls[1]}\`, which can serve as a blueprint for creating objects.`;

  const fn = trimmed.match(/^(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+(?:&\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/);
  if (fn) {
    return fn[2].trim()
      ? `Defines the function \`${fn[1]}\`, which accepts \`${fn[2].trim()}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  const forEach = trimmed.match(/^foreach\s*\(\s*\$([A-Za-z_]\w*)\s+as\s+(?:\$([A-Za-z_]\w*)\s*=>\s*)?\$([A-Za-z_]\w*)\s*\)/);
  if (forEach) {
    const source = forEach[1];
    const keyVar = forEach[2];
    const valueVar = forEach[3];
    return keyVar
      ? `Iterates over \`$${source}\`; on each pass, \`$${keyVar}\` holds the current key and \`$${valueVar}\` the current value.`
      : `Iterates over \`$${source}\`; on each pass, \`$${valueVar}\` represents the current item.`;
  }

  if (/^for\s*\(/.test(trimmed)) {
    return explainClassicForLoop(trimmed) || "Starts a counted loop that repeats a block of code a set number of times.";
  }
  if (/^while\s*\(/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";
  if (/^do\s*\{?$/.test(trimmed)) return "Starts a do/while loop, which always runs its body at least once before checking the condition.";

  const ifMatch = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
  if (ifMatch) return `Checks whether \`${ifMatch[1].trim()}\` is true before running the code that follows.`;
  if (/^\}?\s*elseif\s*\((.+)\)/.test(trimmed)) {
    const m = trimmed.match(/^\}?\s*elseif\s*\((.+)\)/);
    return `Checks another condition (\`${m[1].trim()}\`) when the previous one was not met.`;
  }
  if (/^\}?\s*else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";

  const throwMatch = trimmed.match(/^throw\s+new\s+([A-Za-z_]\w*)\s*\((.*)\)\s*;?$/);
  if (throwMatch) {
    const [, exClass, args] = throwMatch;
    return args.trim()
      ? `Throws a new \`${exClass}\` exception with the message \`${args.trim()}\`, immediately stopping normal execution (handled by a \`catch\` block, if one is present).`
      : `Throws a new \`${exClass}\` exception, immediately stopping normal execution (handled by a \`catch\` block, if one is present).`;
  }

  // PHP 8's `match` expression header, e.g. `$s = match($code) {` or
  // a bare `match($code) {`.
  const matchHeader = trimmed.match(/^(?:\$?[A-Za-z_]\w*\s*=\s*)?match\s*\((.+?)\)\s*\{?$/);
  if (matchHeader) {
    return `Starts a \`match\` expression on \`${matchHeader[1].trim()}\`: evaluates the arms below in order and produces the value from the first one whose condition(s) strictly equal it.`;
  }
  const matchArm = trimmed.match(/^(default|.+?)\s*=>\s*(.+?),?$/);
  if (matchArm && !/^function\b|^if\b|^foreach\b|^fn\s*\(|^\$\w+\s*=>/.test(trimmed)) {
    const [, conditions, result] = matchArm;
    return conditions.trim() === "default"
      ? `Default arm: if none of the earlier conditions matched, the \`match\` expression produces \`${result.trim()}\`.`
      : `If the matched value strictly equals \`${conditions.trim()}\`, the \`match\` expression produces \`${result.trim()}\`.`;
  }

  const catchMatch = trimmed.match(/^\}?\s*catch\s*\(([^)]+)\)\s*\{?$/);
  if (catchMatch) {
    const parts = catchMatch[1].trim().split(/\s+/);
    const varName = parts[parts.length - 1];
    return varName && varName.startsWith("$")
      ? `Catches any error thrown in the \`try\` block above, made available here as \`${varName}\`.`
      : "Catches any error thrown in the `try` block above.";
  }
  if (/^try\s*\{?$/.test(trimmed)) {
    return "Starts a `try` block; if an error occurs anywhere inside it, execution jumps to the matching `catch` block below.";
  }
  if (/^\}?\s*finally\s*\{?$/.test(trimmed)) {
    return "Starts a `finally` block, which always runs after the `try`/`catch`, whether or not an error occurred.";
  }

  const ret = trimmed.match(/^return\b\s*(.*?);?$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current function.` : "Returns control from the current function.";

  const echo = trimmed.match(/^echo\s+(.+?);?$/);
  if (echo) return `Outputs ${mdCode(echo[1].trim())} to the page/console.`;
  const print = trimmed.match(/^print\s*\((.+?)\)\s*;?$/);
  if (print) return `Outputs ${mdCode(print[1].trim())} to the page/console.`;

  const decl = trimmed.match(/^\$([A-Za-z_]\w*)\s*=\s*(.+);/);
  if (decl) {
    const ternary = explainTernary(`$${decl[1]}`, decl[2]);
    if (ternary) return ternary;
    if (/^\[.*\]$/s.test(decl[2].trim()) || /^array\s*\(/.test(decl[2].trim())) {
      return `Creates the array \`$${decl[1]}\` containing ${mdCode(decl[2].trim())}.`;
    }
    return `Assigns ${mdCode(decl[2])} to the variable \`$${decl[1]}\`.`;
  }

  const call = trimmed.match(/^([A-Za-z_]\w*)\s*\((.*)\)\s*;?$/);
  if (call) {
    return call[2].trim()
      ? `Calls \`${call[1]}()\` with the provided argument(s).`
      : `Calls \`${call[1]}()\` without arguments.`;
  }

  return null;
}

// ------------------------------------------------------------
// Issue checks
// ------------------------------------------------------------

// Already covered by the shared, generic findCommonIssues() check —
// filtered out below so the AST-based version (real block
// boundaries, not indentation guessing) doesn't double-report.
const SUPERSEDED_MESSAGES = new Set([
  "This error handler is empty — the exception is silently swallowed. Consider at least logging it, even if no other action is needed.",
  "This line comes right after a `return` in the same block, so it can never be reached.",
]);

// One-hop taint tracking, ported from the old regex analyzer: a
// variable assigned directly from a superglobal (and not sanitized
// on that same line) is "tainted" until further notice. Computed
// once up front over the raw lines — same approach as before, just
// no longer the *only* pass (issues from AST nodes are layered on
// top of this).
function findTaintedVars(lines) {
  const tainted = new Set();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const taintedAssign = line.match(/^\$(\w+)\s*=\s*\$_(?:GET|POST|REQUEST|COOKIE)\s*\[/);
    if (taintedAssign && !/\b(htmlspecialchars|intval|\(int\)|filter_var)\s*\(/.test(line)) {
      tainted.add(taintedAssign[1]);
    }
  }
  return tainted;
}

function checkPhpLineIssues(rawLine, lineNumber, taintedVars, issues) {
  const line = rawLine.trim();

  if (/\bmysql_query\s*\(/.test(line)) {
    issues.push({ line: lineNumber, type: "security", message: "The `mysql_*` extension is removed from modern PHP and was prone to SQL injection. Use PDO or mysqli with prepared statements." });
  }

  if (/^(echo|print)\b/.test(line) && /\$_(GET|POST|REQUEST|COOKIE)\b/.test(line) && !/\bhtmlspecialchars\s*\(/.test(line)) {
    issues.push({ line: lineNumber, type: "security", message: "Echoes a superglobal (`$_GET`/`$_POST`/etc.) directly without escaping — a reflected XSS risk. Wrap it in `htmlspecialchars()` before output." });
  } else {
    const echoVar = line.match(/^(?:echo|print)\b\s*\$(\w+)\s*;?\s*$/);
    if (echoVar && taintedVars.has(echoVar[1])) {
      issues.push({ line: lineNumber, type: "security", message: `\`$${echoVar[1]}\` was assigned from a superglobal (\`$_GET\`/\`$_POST\`/etc.) earlier and is echoed here without escaping — a reflected XSS risk. Wrap it in \`htmlspecialchars()\` before output.` });
    }
  }

  if (/\b(include|include_once|require|require_once)\s+\$/.test(line) || /\b(include|include_once|require|require_once)\s*\(\s*\$/.test(line)) {
    issues.push({ line: lineNumber, type: "security", message: "Includes a file using a variable path. If that value can be influenced by user input, this is a local/remote file inclusion risk." });
  }

  const shellCall = line.match(/\b(system|exec|shell_exec|passthru)\s*\((.+)\)\s*;?$/);
  if (shellCall && !/^["'].*["']$/.test(shellCall[2].trim())) {
    issues.push({ line: lineNumber, type: "security", message: `\`${shellCall[1]}()\` runs its argument as a shell command. If any part of it comes from user input, this is a command-injection risk — validate/escape with \`escapeshellarg()\` at minimum.` });
  }

  if (/\bunserialize\s*\(/.test(line)) {
    issues.push({ line: lineNumber, type: "security", message: "`unserialize()` on untrusted input can be used to construct arbitrary objects (PHP object injection). Prefer `json_decode()` for data from users." });
  }
}

// ------------------------------------------------------------
// Structure
// ------------------------------------------------------------

function updateStructure(node, rawLine, structure, lineNumber) {
  if (node.type === "comment") {
    structure.comments.push(lineNumber);
    return;
  }

  if (node.type === "function_definition" || node.type === "method_declaration") {
    const fn = rawLine.match(/^(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+(?:&\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) structure.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });
  } else if (node.type === "class_declaration") {
    const cls = rawLine.match(/\bclass\s+([A-Za-z_]\w*)/);
    if (cls) structure.classes.push({ line: lineNumber, name: cls[1] });
  } else if (/^(require|include)(_once)?\b/.test(rawLine.trim())) {
    structure.imports.push(lineNumber);
  } else if (node.type === "assignment_expression") {
    const decl = rawLine.trim().match(/^\$([A-Za-z_]\w*)\s*=/);
    if (decl) structure.variables.push({ line: lineNumber, name: `$${decl[1]}` });
  } else if (["foreach_statement", "for_statement", "while_statement", "do_statement"].includes(node.type)) {
    structure.loops.push(lineNumber);
  } else if (node.type === "if_statement" || node.type === "match_expression") {
    structure.conditionals.push(lineNumber);
  } else if (node.type === "return_statement") {
    structure.returns.push(lineNumber);
  } else if (/^(echo|print)\b/.test(rawLine.trim())) {
    structure.outputs.push(lineNumber);
  }
}

// ------------------------------------------------------------
// Single entry point
// ------------------------------------------------------------

export async function analyzeAst(code) {
  await ensureReady();

  // Tree-sitter-php's grammar treats the top level as an HTML
  // document that only switches into PHP parsing inside <?php ... ?>
  // blocks — anything outside of a tag is a single opaque "text"
  // node, not statements. Snippets in this project (see `detect()`
  // above) are routinely pasted without the tag, so parse a
  // tag-prefixed copy of the source and shift line numbers back by
  // the one line we added. `lines` (used for all rawLine lookups)
  // stays based on the original, unmodified code.
  const hasTag = /<\?php/.test(code);
  const parseSource = hasTag ? code : `<?php\n${code}`;
  const lineOffset = hasTag ? 0 : 1;

  const parser = new Parser();
  parser.setLanguage(PHPLang);
  const tree = parser.parse(parseSource);
  const root = tree.rootNode;
  const lines = code.split("\n");

  const structure = {
    functions: [], classes: [], imports: [], variables: [],
    loops: [], conditionals: [], returns: [], outputs: [], comments: [],
  };
  const issues = findCommonIssues(lines).filter((issue) => !SUPERSEDED_MESSAGES.has(issue.message));
  const taintedVars = findTaintedVars(lines);
  const lineExplanations = [];
  const explainedLines = new Set();
  const issueCheckedLines = new Set();

  function walk(node) {
    const lineNumber = lineOf(node, lineOffset);
    const rawLine = lines[lineNumber - 1] || "";

    updateStructure(node, rawLine, structure, lineNumber);
    if (!issueCheckedLines.has(lineNumber)) {
      checkPhpLineIssues(rawLine, lineNumber, taintedVars, issues);
      issueCheckedLines.add(lineNumber);
    }

    // Empty catch block — real block boundary from the AST instead
    // of the indentation-guessing the shared generic check uses.
    if (node.type === "catch_clause") {
      const body = node.childForFieldName("body");
      if (body && body.namedChildCount === 0) {
        issues.push({
          line: lineNumber,
          type: "review",
          message: "This error handler is empty — the exception is silently swallowed. Consider at least logging it, even if no other action is needed.",
        });
      }
    }

    // Unreachable code right after a `return` in the same block.
    if (node.type === "return_statement") {
      const next = node.nextNamedSibling;
      if (next && next.type !== "comment") {
        issues.push({
          line: lineOf(next, lineOffset),
          type: "warning",
          message: "This line comes right after a `return` in the same block, so it can never be reached.",
        });
      }
    }

    if (!explainedLines.has(lineNumber)) {
      const text = explainPhpLine(rawLine);
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
