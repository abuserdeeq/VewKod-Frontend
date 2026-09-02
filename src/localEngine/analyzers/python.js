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
import { findCommonIssues, mdCode } from "../shared/patterns.js";

export const id = "python";
export const label = "Python";

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

// Lightweight per-function symbol tracking — enough to answer "is
// this name a list/dict/number/loop-item in the current function?"
// so a handful of explanations can be more specific ("the current
// item (`user`)" instead of just "`user`"). Deliberately not a full
// scope/type system: built fresh per function_definition, so the
// same name in two different functions never cross-contaminates.
function buildSymbols(funcBodyNode) {
  const symbols = new Map();
  function scan(node) {
    if (node.type === "assignment") {
      const left = node.childForFieldName("left");
      const right = node.childForFieldName("right");
      if (left && left.type === "identifier" && right) {
        if (right.type === "list" || right.type === "list_comprehension") symbols.set(left.text, "list");
        else if (right.type === "dictionary" || right.type === "dictionary_comprehension") symbols.set(left.text, "dictionary");
        else if (right.type === "set" || right.type === "set_comprehension") symbols.set(left.text, "set");
        else if (right.type === "string") symbols.set(left.text, "string");
        else if (right.type === "integer" || right.type === "float") symbols.set(left.text, "number");
      }
    }
    if (node.type === "for_statement") {
      const left = node.childForFieldName("left");
      if (left && left.type === "identifier") symbols.set(left.text, "loop-item");
    }
    for (const child of node.namedChildren) scan(child);
  }
  if (funcBodyNode) scan(funcBodyNode);
  return symbols;
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

function explainNode(node, symbols) {
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
      if (condition && condition.type === "identifier") {
        const role = symbols.get(condition.text);
        if (role === "loop-item") {
          return `Checks whether the current item (${mdCode(condition.text)}) is true before running the code that follows.`;
        }
        if (role === "number") {
          return `Checks whether the number stored in ${mdCode(condition.text)} is truthy (non-zero) before running the code that follows.`;
        }
      }
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
        if (arg.type === "identifier" && symbols.get(arg.text) === "number") {
          return `Displays the number stored in ${mdCode(arg.text)} as program output.`;
        }
        if (arg.type === "identifier" && symbols.get(arg.text) === "loop-item") {
          return `Displays the current item (${mdCode(arg.text)}) as program output.`;
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

        if (obj && obj.type === "identifier" && symbols.has(obj.text)) {
          const role = symbols.get(obj.text);
          return args
            ? `Calls \`.${attr.text}(${args})\` on the ${mdCode(obj.text)} ${role}.`
            : `Calls \`.${attr.text}()\` on the ${mdCode(obj.text)} ${role}.`;
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

        // Plain list/dict/set literal (not a comprehension) — e.g.
        // `x = [1, 2, 3]`.
        if (right && right.type === "list") {
          const items = right.namedChildren.map((c) => c.text).join(", ");
          return items
            ? `Creates the list ${mdCode(left.text)}, containing ${mdCode(items)}.`
            : `Creates the empty list ${mdCode(left.text)}.`;
        }
        if (right && right.type === "dictionary") {
          return `Creates the dictionary ${mdCode(left.text)}.`;
        }
        if (right && right.type === "set") {
          return `Creates the set ${mdCode(left.text)}.`;
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
  if (node.type === "except_clause") {
    const block = node.namedChildren.find((c) => c.type === "block");
    if (block && block.namedChildCount === 1 && block.namedChild(0).type === "pass_statement") {
      issues.push({
        line: lineOf(node),
        type: "review",
        message: "This error handler is empty — the exception is silently swallowed. Consider at least logging it, even if no other action is needed.",
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

  // Python-specific dangerous-call checks (os.system/subprocess with a
  // non-literal command, pickle deserialization, unsafe yaml.load).
  // These existed in the old regex-based python.js as its own
  // findIssues() checks (on top of the shared ones) and were lost
  // when this file was replaced — restored here via AST instead.
  if (node.type === "call") {
    const fn = node.childForFieldName("function");
    if (fn && fn.type === "attribute") {
      const obj = fn.childForFieldName("object")?.text;
      const attr = fn.childForFieldName("attribute")?.text;
      const argsNode = node.childForFieldName("arguments");
      const firstArg = argsNode ? argsNode.namedChildren[0] : null;

      if (obj === "os" && attr === "system" && firstArg && firstArg.type !== "string") {
        issues.push({
          line: lineOf(node),
          type: "security",
          message: "Calling `os.system()` with a non-literal command can allow command injection if any part of the value comes from user input. Consider `subprocess.run([...])` with a list of arguments instead.",
        });
      }

      if (obj === "subprocess" && ["run", "call", "Popen", "check_call", "check_output"].includes(attr)) {
        const hasShellTrue = argsNode?.namedChildren.some(
          (a) => a.type === "keyword_argument" && a.childForFieldName("name")?.text === "shell" && a.childForFieldName("value")?.text === "True"
        );
        if (hasShellTrue) {
          issues.push({
            line: lineOf(node),
            type: "security",
            message: "This uses `subprocess...(..., shell=True)`, which can allow command injection if any part of the command comes from user input. Prefer passing a list of arguments without `shell=True`.",
          });
        }
      }

      if (obj === "pickle" && (attr === "loads" || attr === "load")) {
        issues.push({
          line: lineOf(node),
          type: "security",
          message: "`pickle.load()`/`pickle.loads()` can execute arbitrary code when deserializing untrusted data. Avoid unpickling data from an untrusted source.",
        });
      }

      if (obj === "yaml" && attr === "load") {
        const hasSafeLoader = argsNode?.namedChildren.some(
          (a) => a.type === "keyword_argument" && a.childForFieldName("name")?.text === "Loader" && /SafeLoader/.test(a.childForFieldName("value")?.text || "")
        );
        if (!hasSafeLoader) {
          issues.push({
            line: lineOf(node),
            type: "security",
            message: "`yaml.load()` without `Loader=yaml.SafeLoader` can execute arbitrary code from the input. Use `yaml.safe_load()` or pass `Loader=yaml.SafeLoader`.",
          });
        }
      }
    }
  }

  // Unused variable: assigned within a function but never referenced
  // again anywhere else in that same function. Scoped per-function
  // (not globally) so the same name in two different functions can't
  // cross-contaminate. AST-based, so this is a real reference count,
  // not a text-search guess.
  if (node.type === "function_definition") {
    checkUnusedVariables(node, issues);
  }
}

function checkUnusedVariables(funcNode, issues) {
  const assigned = new Map(); // name -> line of first assignment
  const identifierCounts = new Map(); // name -> total identifier occurrences

  function collect(node) {
    if (node.type === "identifier") {
      identifierCounts.set(node.text, (identifierCounts.get(node.text) || 0) + 1);
    }
    if ((node.type === "assignment" || node.type === "augmented_assignment")) {
      const left = node.childForFieldName("left");
      if (left && left.type === "identifier" && !assigned.has(left.text)) {
        assigned.set(left.text, lineOf(node));
      }
    }
    for (const child of node.namedChildren) collect(child);
  }
  collect(funcNode);

  for (const [name, line] of assigned) {
    // Only ever appears once (the assignment target itself) → never
    // read anywhere else in the function.
    if ((identifierCounts.get(name) || 0) <= 1) {
      issues.push({
        line,
        type: "review",
        message: `The variable \`${name}\` is assigned here but doesn't appear to be used again — it may not be used later in the function, so consider removing it if it isn't needed.`,
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
    structure.functions.push({
      line: lineNumber,
      name: nameNode ? nameNode.text : "?",
      parameters: paramsNode ? paramsNode.text.slice(1, -1).trim() : "",
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

// These two checks already exist inside findCommonIssues() (added
// earlier this session, shared across all regex-based languages) —
// but Python's own AST-based versions below are strictly more
// reliable (real block/scope boundaries instead of indentation
// guessing or same-line/two-line lookahead). Filtering these two
// specific messages out of the shared results before merging avoids
// showing the same issue twice, once from each source.
const SUPERSEDED_MESSAGES = new Set([
  "This error handler is empty — the exception is silently swallowed. Consider at least logging it, even if no other action is needed.",
  "This line comes right after a `return` in the same block, so it can never be reached.",
]);

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
  // Text-pattern checks (TODO/FIXME, hard-coded secrets, eval(),
  // division-by-zero, SQL injection, 0.0.0.0 bind, etc.) — the same
  // shared checks every regex-based language analyzer already gets.
  // These are inherently textual/heuristic, so there's no AST-based
  // improvement to make here; reusing the existing shared function
  // avoids re-implementing ~8 checks and keeps Python in parity with
  // the other 13 languages instead of silently losing them when it
  // switched to AST-based analysis. The two checks Python now does
  // better via AST are filtered out here so they don't also show up
  // via the regex version below.
  const issues = findCommonIssues(code.split("\n")).filter(
    (issue) => !SUPERSEDED_MESSAGES.has(issue.message)
  );
  const lineExplanations = [];

  function walk(node, symbols) {
    updateStructure(node, structure);
    // AST-based checks — genuinely more reliable than regex/
    // indentation guessing for these two specifically (this is what
    // the whole Tree-sitter migration originally set out to fix).
    checkIssues(node, issues);

    // Entering a new function scope: build a fresh symbol map from
    // its own body and use that for everything inside it, instead of
    // inheriting the caller's. This is what keeps the same variable
    // name in two different functions from cross-contaminating.
    if (node.type === "function_definition") {
      const explanation = explainNode(node, symbols);
      if (explanation) {
        lineExplanations.push({ line: lineOf(node), text: explanation });
      }
      const body = node.childForFieldName("body");
      const localSymbols = buildSymbols(body);
      for (const child of node.namedChildren) walk(child, localSymbols);
      return;
    }

    const explanation = explainNode(node, symbols);
    if (explanation) {
      lineExplanations.push({ line: lineOf(node), text: explanation });
    }

    for (const child of node.namedChildren) walk(child, symbols);
  }

  walk(root, new Map());

  lineExplanations.sort((a, b) => a.line - b.line);

  return { structure, issues, lineExplanations };
}
