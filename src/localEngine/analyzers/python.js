// ============================================================
// Python analyzer — Tree-sitter (AST) based
// ============================================================
// Replaces the old regex/indentation-based analyzer entirely (no
// dual maintenance). Consolidates what were three separate pilot
// files (pythonTreeSitter.js, pythonLineExplainer.js's line
// explanations, and its structure breakdown) into one module that
// parses the source ONCE and derives everything from that single
// tree, instead of walking it three separate times.
//
// Unlike every other analyzer in this folder (which are synchronous
// and called per-line by engineRunner.js), this one is
// fundamentally async — loading the WASM parser/grammar can't be
// done synchronously. It exposes a single `analyzeAst(code)` entry
// point instead of the old buildSymbolTable/analyzeStructure/
// explainLine/findIssues quartet; engineRunner.js detects AST-based
// analyzers (by the presence of `analyzeAst`) and calls this path
// instead of the regex-based one.

import Parser from "web-tree-sitter";
import { findCommonIssues } from "../shared/patterns.js";

export const id = "python";
export const label = "Python";
// Python explanations can safely show a little more source before
// falling back to the remainder summary. This keeps medium-sized
// Python snippets fully useful in Code Explanation without changing
// the output limit for the other language analyzers.
export const maxExplanationLines = 80;

// Where to fetch/read the .wasm files from differs by environment:
// in a real Node.js process (our test suite runs via `node --test`),
// web-tree-sitter reads them straight from the filesystem, so a
// node_modules-relative path is used. In the browser (the actual
// production app), there is no filesystem — the same files are
// copied into public/wasm/ at install time (see
// scripts/copy-wasm.js) and fetched from a root-relative URL
// instead. `process.versions.node` only exists in a real Node
// runtime, never in a browser (including inside a Vite bundle), so
// it's a reliable way to tell the two apart.
const isNode = typeof process !== "undefined" && !!process.versions?.node;

const WASM_CORE_PATH = isNode
  ? "./node_modules/web-tree-sitter/tree-sitter.wasm"
  : "/wasm/tree-sitter.wasm";
const WASM_PYTHON_PATH = isNode
  ? "./node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm"
  : "/wasm/tree-sitter-python.wasm";

export function detect(code) {
  // Same detection heuristic as the old regex-based analyzer —
  // detection itself doesn't need the AST, and must stay fast/sync
  // since it runs before we know it's Python at all.
  const hasPythonDef = /^\s*def\s+\w+\s*\([^)]*\)\s*:\s*$/m.test(code);
  const hasElif = /\belif\b/.test(code);
  const hasColonBlocks = /:\s*(#.*)?$/m.test(code) && !/[{};]/.test(code);
  return hasPythonDef || hasElif || hasColonBlocks;
}

let PythonLang = null;
let ready = false;

async function ensureReady() {
  if (ready) return;
  // locateFile tells the Emscripten-based runtime where to fetch its
  // own core .wasm from in the browser, since by default it looks
  // relative to the bundled JS file's own location — which is wrong
  // once Vite bundles everything. Not needed in Node, where the
  // default filesystem-relative resolution already works (confirmed
  // during pilot testing). Untested against a real browser build
  // yet; if Parser.init() throws there, this is the first thing to
  // check.
  await Parser.init(isNode ? undefined : { locateFile: () => WASM_CORE_PATH });
  PythonLang = await Parser.Language.load(WASM_PYTHON_PATH);
  ready = true;
}

function mdCode(text) {
  return `\`${text}\``;
}

function lineOf(node) {
  return node.startPosition.row + 1;
}

function isRangeCall(node) {
  return node.type === "call" && node.childForFieldName("function")?.text === "range";
}

// ------------------------------------------------------------
// Per-line explanation (mirrors the old explainLine's phrasing)
// ------------------------------------------------------------

function explainNode(node) {
  switch (node.type) {
    case "import_statement":
    case "import_from_statement":
      return "Imports a library or module so functionality from another part of the project (or Python's standard library) can be used.";

    case "decorator": {
      const text = node.text.replace(/^@/, "");
      return `Applies the \`@${text}\` decorator to the function/method defined below, wrapping it with extra behavior.`;
    }

    case "function_definition": {
      const nameNode = node.childForFieldName("name");
      const paramsNode = node.childForFieldName("parameters");
      const params = paramsNode ? paramsNode.text.slice(1, -1).trim() : "";
      const name = nameNode ? nameNode.text : "?";
      return params
        ? `Defines the function \`${name}\`, which accepts \`${params}\` as parameter(s).`
        : `Defines the function \`${name}\` without parameters.`;
    }

    case "class_definition": {
      const nameNode = node.childForFieldName("name");
      const superclasses = node.childForFieldName("superclasses");
      const bases = superclasses ? superclasses.text.slice(1, -1).trim() : "";
      const name = nameNode ? nameNode.text : "?";
      return bases
        ? `Defines the class \`${name}\`, which inherits from \`${bases}\`.`
        : `Defines the class \`${name}\`, which can serve as a blueprint for creating objects.`;
    }

    case "for_statement": {
      const left = node.childForFieldName("left");
      const right = node.childForFieldName("right");
      const targets = left ? left.text : "?";
      if (right && isRangeCall(right)) {
        return `Loops through a sequence of numbers produced by ${mdCode(right.text)}, with ${mdCode(targets)} holding the current number on each pass.`;
      }
      return `Iterates over ${mdCode(right ? right.text : "?")}; on each pass, ${mdCode(targets)} represents the current item.`;
    }

    case "while_statement": {
      const condition = node.childForFieldName("condition");
      if (condition && condition.text === "True") {
        return "Starts an intentionally infinite loop, which must be exited with a `break` or `return` elsewhere.";
      }
      return "Starts a while loop that keeps running as long as its condition stays true.";
    }

    case "if_statement": {
      const condition = node.childForFieldName("condition");
      return `Checks whether ${mdCode(condition ? condition.text : "?")} is true before running the code that follows.`;
    }

    case "elif_clause": {
      const condition = node.childForFieldName("condition");
      return `Checks another condition (${mdCode(condition ? condition.text : "?")}) before running the code that follows.`;
    }

    case "else_clause":
      return "Defines the alternative block that runs when none of the earlier conditions were true.";

    case "try_statement":
      return "Starts a `try` block; if an error occurs anywhere inside it, control jumps to the matching `except` block below.";

    case "except_clause": {
      const kids = node.namedChildren;
      let excType = null;
      let excName = null;
      if (kids[0]) {
        if (kids[0].type === "as_pattern") {
          const parts = kids[0].namedChildren;
          excType = parts[0] ? parts[0].text : null;
          excName = parts[1] ? parts[1].text : null;
        } else if (kids[0].type !== "block") {
          excType = kids[0].text;
        }
      }
      if (!excType) return "Catches any exception raised in the `try` block above.";
      return excName
        ? `Catches a \`${excType}\` exception raised in the \`try\` block above, made available here as \`${excName}\`.`
        : `Catches a \`${excType}\` exception raised in the \`try\` block above.`;
    }

    case "finally_clause":
      return "Starts a `finally` block, which always runs after the `try`/`except`, whether or not an exception occurred.";

    case "raise_statement": {
      const value = node.namedChildren[0];
      return value
        ? `Raises an exception (${mdCode(value.text)}), stopping normal execution so it can be caught by an enclosing \`try\`/\`except\`.`
        : "Re-raises the exception currently being handled.";
    }

    case "pass_statement":
      return "Does nothing intentionally and lets execution continue with the next statement or block exit.";

    case "return_statement": {
      const value = node.namedChildren[0];
      return value
        ? `Returns ${mdCode(value.text)} from the current function.`
        : "Returns control from the current function without a value.";
    }

    case "expression_statement": {
      const inner = node.namedChildren[0];
      if (!inner) return null;

      if (inner.type === "call" && inner.childForFieldName("function")?.text === "print") {
        const argsNode = inner.childForFieldName("arguments");
        const arg = argsNode ? argsNode.namedChildren[0] : null;
        if (!arg) return "Prints a blank line as program output.";
        if (arg.type === "string" && arg.text.match(/^[fF]["']/)) {
          return `Displays a formatted message, embedding the enclosed expressions into the text.`;
        }
        return `Displays ${mdCode(arg.text)} as program output.`;
      }

      if (inner.type === "call" && inner.childForFieldName("function")?.type === "attribute") {
        const fn = inner.childForFieldName("function");
        const obj = fn.childForFieldName("object");
        const attr = fn.childForFieldName("attribute");
        const argsNode = inner.childForFieldName("arguments");
        const args = argsNode ? argsNode.text.slice(1, -1).trim() : "";

        if (obj && obj.type === "call" && obj.childForFieldName("function")?.text === "super") {
          return args
            ? `Calls the parent class's \`${attr.text}()\` method via \`super()\`, passing ${mdCode(args)}.`
            : `Calls the parent class's \`${attr.text}()\` method via \`super()\`.`;
        }

        return args
          ? `Calls \`.${attr.text}(${args})\` on ${mdCode(obj.text)}.`
          : `Calls \`.${attr.text}()\` on ${mdCode(obj.text)}.`;
      }

      if (inner.type === "call") {
        const fnName = inner.childForFieldName("function")?.text || "?";
        const argsNode = inner.childForFieldName("arguments");
        const hasArgs = argsNode && argsNode.namedChildCount > 0;
        return hasArgs
          ? `Calls \`${fnName}()\` with the provided argument(s).`
          : `Calls \`${fnName}()\` without arguments.`;
      }

      if (inner.type === "augmented_assignment") {
        const left = inner.childForFieldName("left");
        const opNode = inner.child(1);
        const right = inner.childForFieldName("right");
        const opVerbs = {
          "+=": ["Increases", "by"],
          "-=": ["Decreases", "by"],
          "*=": ["Multiplies", "by"],
          "/=": ["Divides", "by"],
          "//=": ["Floor-divides", "by"],
          "%=": ["Takes the remainder (modulo) of", "by"],
          "**=": ["Raises", "to the power of"],
        };
        const opText = opNode ? opNode.text : "+=";
        const [verb, prep] = opVerbs[opText] || ["Updates", "by"];
        return `${verb} the variable ${mdCode(left ? left.text : "?")} ${prep} ${mdCode(right ? right.text : "?")}.`;
      }

      if (inner.type === "assignment") {
        const left = inner.childForFieldName("left");
        const right = inner.childForFieldName("right");

        if (left && left.type === "pattern_list") {
          const targets = left.namedChildren.map((t) => t.text);
          if (right && right.type === "expression_list") {
            const values = right.namedChildren.map((v) => v.text);
            if (values.length === targets.length) {
              if (targets.length === 2 && values[0] === targets[1] && values[1] === targets[0]) {
                return `Swaps the values of ${mdCode(targets[0])} and ${mdCode(targets[1])} using parallel assignment (both sides are evaluated before either variable is updated).`;
              }
              const pairs = targets.map((t, i) => `${mdCode(t)} becomes ${mdCode(values[i])}`).join(", ");
              return `Assigns several variables at once (parallel assignment): ${pairs}.`;
            }
          }
          return `Unpacks ${mdCode(right ? right.text : "?")} into ${targets.map(mdCode).join(", ")} in a single line.`;
        }

        if (left && left.type === "attribute") {
          const objText = left.childForFieldName("object")?.text;
          const kind = objText === "self" ? "instance attribute" : "attribute";
          return `Sets the ${kind} ${mdCode(left.text)} to ${mdCode(right ? right.text : "?")}.`;
        }

        if (right && (right.type === "list_comprehension" || right.type === "set_comprehension" || right.type === "dictionary_comprehension")) {
          const name = left ? left.text : "?";
          const forClause = right.namedChildren.find((c) => c.type === "for_in_clause");
          const ifClause = right.namedChildren.find((c) => c.type === "if_clause");
          const target = forClause ? forClause.childForFieldName("left")?.text : "?";
          const iterable = forClause ? forClause.childForFieldName("right")?.text : "?";
          const condPart = ifClause ? ` (only when ${mdCode(ifClause.namedChildren[0]?.text || "?")} is true)` : "";

          if (right.type === "dictionary_comprehension") {
            const pair = right.namedChildren.find((c) => c.type === "pair");
            const key = pair ? pair.childForFieldName("key")?.text : "?";
            const val = pair ? pair.childForFieldName("value")?.text : "?";
            return `Creates the dictionary ${mdCode(name)} by mapping ${mdCode(key)} to ${mdCode(val)} for each ${mdCode(target)} in ${mdCode(iterable)}${condPart} — a dict comprehension.`;
          }
          const kind = right.type === "list_comprehension" ? "list" : "set";
          const expr = right.namedChildren[0]?.text || "?";
          return `Creates the ${kind} ${mdCode(name)} by evaluating ${mdCode(expr)} for each ${mdCode(target)} in ${mdCode(iterable)}${condPart} — a ${kind} comprehension.`;
        }

        if (right && right.type === "conditional_expression") {
          const name = left ? left.text : "?";
          const [whenTrue, condition, whenFalse] = right.namedChildren;
          if (whenTrue && condition && whenFalse) {
            return `Assigns ${mdCode(name)} to ${mdCode(whenTrue.text)} if ${mdCode(condition.text)} is true, otherwise ${mdCode(whenFalse.text)} — a conditional (ternary) expression.`;
          }
        }

        return `Assigns ${mdCode(right ? right.text : "?")} to the variable ${mdCode(left ? left.text : "?")}.`;
      }

      return null;
    }

    default:
      return null;
  }
}

// ------------------------------------------------------------
// Issue checks (mirrors pythonTreeSitter.js's pilot logic)
// ------------------------------------------------------------

function checkIssues(node, issues) {
  // `@staticmethod` is intended for methods defined inside a class.
  // Depending on the Python grammar version, decorators may be exposed
  // as children of the function definition or as named siblings. Check
  // both shapes so this review rule remains stable across parser updates.
  if (node.type === "function_definition") {
    const hasStaticMethodDecorator =
      /(^|\n)\s*@staticmethod\s*(?:#.*)?$/.test(node.text) ||
      (() => {
        let sibling = node.previousNamedSibling;
        while (sibling && sibling.type === "decorator") {
          if (/^@staticmethod\s*(?:#.*)?$/.test(sibling.text.trim())) return true;
          sibling = sibling.previousNamedSibling;
        }
        return false;
      })();

    if (hasStaticMethodDecorator) {
      let parent = node.parent;
      while (parent && parent.type !== "class_definition" && parent.type !== "module") {
        parent = parent.parent;
      }
      if (!parent || parent.type !== "class_definition") {
        const inlineDecorator = node.namedChildren.find(
          (child) => child.type === "decorator" && /^@staticmethod\s*(?:#.*)?$/.test(child.text.trim())
        );
        const siblingDecorator = node.previousNamedSibling?.type === "decorator"
          ? node.previousNamedSibling
          : null;
        const decoratorLine = inlineDecorator
          ? lineOf(inlineDecorator)
          : siblingDecorator
            ? lineOf(siblingDecorator)
            : lineOf(node);
        issues.push({
          line: decoratorLine,
          type: "review",
          message: "`@staticmethod` is normally used on methods inside a class; this top-level function may be decorated unintentionally.",
        });
      }
    }
  }

  if (node.type === "except_clause") {
    const block = node.namedChildren.find((c) => c.type === "block");
    if (block && block.namedChildCount === 1 && block.namedChild(0).type === "pass_statement") {
      const passStatement = block.namedChild(0);
      issues.push({
        line: lineOf(passStatement),
        type: "review",
        message: "This exception handler only contains `pass`, so the exception is silently ignored. Consider logging or handling it appropriately.",
      });
    }
  }

  if (node.type === "return_statement") {
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

// ------------------------------------------------------------
// Structure (mirrors the old analyzeStructure's categories)
// ------------------------------------------------------------

function addVariableTargets(node, lineNumber, structure) {
  if (!node) return;
  if (node.type === "identifier") {
    structure.variables.push({ line: lineNumber, name: node.text });
  } else if (node.type === "pattern_list") {
    for (const child of node.namedChildren) {
      if (child.type === "identifier") structure.variables.push({ line: lineNumber, name: child.text });
    }
  }
}

function updateStructure(node, structure) {
  const lineNumber = lineOf(node);

  if (node.type === "comment") {
    structure.comments.push(lineNumber);
  } else if (node.type === "function_definition") {
    const nameNode = node.childForFieldName("name");
    const paramsNode = node.childForFieldName("parameters");
    const parameters = paramsNode ? paramsNode.text.slice(1, -1).trim() : "";
    structure.functions.push({
      line: lineNumber,
      name: nameNode ? nameNode.text : "?",
      parameters,
    });
  } else if (node.type === "class_definition") {
    const nameNode = node.childForFieldName("name");
    structure.classes.push({ line: lineNumber, name: nameNode ? nameNode.text : "?" });
  } else if (node.type === "import_statement" || node.type === "import_from_statement") {
    structure.imports.push(lineNumber);
  } else if (node.type === "assignment" || node.type === "augmented_assignment") {
    addVariableTargets(node.childForFieldName("left"), lineNumber, structure);
  } else if (node.type === "for_statement" || node.type === "while_statement") {
    structure.loops.push(lineNumber);
  } else if (node.type === "if_statement" || node.type === "elif_clause" || node.type === "else_clause") {
    structure.conditionals.push(lineNumber);
  } else if (node.type === "return_statement") {
    structure.returns.push(lineNumber);
  } else if (node.type === "call" && node.childForFieldName("function")?.text === "print") {
    structure.outputs.push(lineNumber);
  }
}

// ------------------------------------------------------------
// Single entry point — one parse, everything derived from it
// ------------------------------------------------------------

/**
 * Parses the source once and returns everything engineRunner.js
 * needs to build the full explanation: structure (for Overview /
 * Structure Breakdown / Key Concepts), issues (for Potential
 * Issues), and lineExplanations (for Line-by-Line Explanation).
 */
export async function analyzeAst(code) {
  await ensureReady();

  const parser = new Parser();
  parser.setLanguage(PythonLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;

  const structure = {
    functions: [], classes: [], imports: [], variables: [],
    loops: [], conditionals: [], returns: [], outputs: [], comments: [],
  };
  // Keep the cross-language safety/review checks that the legacy
  // regex engine provided for every language. The AST-specific checks
  // below remain authoritative for Python's structural cases.
  const lines = code.split("\n");
  const sharedIssues = findCommonIssues(lines).map((issue) => {
    if (/divides by a literal `0`/.test(issue.message)) {
      return {
        ...issue,
        message: "This divides by the literal `0`, which will raise a `ZeroDivisionError` when this line executes. Double-check this value.",
      };
    }
    return issue;
  });

  // Python owns the AST-specific versions of these checks, so remove
  // the legacy regex copies to avoid duplicate findings.
  const issues = sharedIssues.filter((issue) =>
    !/error handler is empty/.test(issue.message) &&
    !/can never be reached/.test(issue.message)
  );
  const lineExplanations = [];

  function walk(node) {
    updateStructure(node, structure);
    checkIssues(node, issues);

    const explanation = explainNode(node);
    if (explanation) {
      lineExplanations.push({ line: lineOf(node), text: explanation });
    }

    for (const child of node.namedChildren) walk(child);
  }

  walk(root);

  // Python's AST may record multiple uses/assignments of the same variable.
  // Keep the existing occurrence count for transparency, but present a
  // compact, de-duplicated name list so Structure Breakdown remains useful
  // without hiding variables behind a generic "and N more" message.
  if (structure.variables.length) {
    const variableNames = [];
    const seenVariableNames = new Set();
    for (const item of structure.variables) {
      if (!seenVariableNames.has(item.name)) {
        seenVariableNames.add(item.name);
        variableNames.push(item.name);
      }
    }
    structure.variableSummary = `${structure.variables.length} variable occurrence${structure.variables.length !== 1 ? "s" : ""} found: ${variableNames.map((name) => `\`${name}\``).join(", ")}.`;
  }

  lineExplanations.sort((a, b) => a.line - b.line);

  // Keep the issue list deterministic and prevent two checks from
  // reporting the exact same finding.
  const severity = { security: 0, warning: 1, review: 2 };
  const uniqueIssues = Array.from(
    new Map(issues.map((issue) => [`${issue.line}|${issue.type}|${issue.message}`, issue])).values()
  ).sort((a, b) => {
    const bySeverity = (severity[a.type] ?? 3) - (severity[b.type] ?? 3);
    return bySeverity || a.line - b.line;
  });

  return { structure, issues: uniqueIssues, lineExplanations };
}
