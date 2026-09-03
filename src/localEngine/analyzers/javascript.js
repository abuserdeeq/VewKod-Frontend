// ============================================================
// JavaScript analyzer — Tree-sitter (AST) based
// ============================================================
// Same architecture as python.js: single async analyzeAst(code)
// entry point, one parse producing structure + issues + per-line
// explanations together, per-function symbol tracking instead of a
// full symbol table, and the shared regex-based findCommonIssues()
// reused for text-pattern checks (TODO, secrets, eval, etc.) with
// the two AST-superseded checks (empty handler, unreachable) filtered
// out to avoid double-reporting.

import Parser from "web-tree-sitter";
import { findCommonIssues, mdCode } from "../shared/patterns.js";

export const id = "javascript";
export const label = "JavaScript";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

const WASM_CORE_PATH = isNode
  ? "./node_modules/web-tree-sitter/tree-sitter.wasm"
  : "/wasm/tree-sitter.wasm";
const WASM_JS_PATH = isNode
  ? "./node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm"
  : "/wasm/tree-sitter-javascript.wasm";

export function detect(code) {
  return (
    /\b(const|let|var|console\.log|=>|function)\b/.test(code) ||
    (/\b(import|export)\b.*\b(from|default)\b/.test(code) && !/:\s*(string|number|boolean)\b/.test(code))
  );
}

let JSLang = null;
let ready = false;

async function ensureReady() {
  if (ready) return;
  await Parser.init(isNode ? undefined : { locateFile: () => WASM_CORE_PATH });
  JSLang = await Parser.Language.load(WASM_JS_PATH);
  ready = true;
}

function lineOf(node) {
  return node.startPosition.row + 1;
}

// Any child (named or not) whose literal text matches — used for
// checking for keywords like "of"/"in"/"static"/"get"/"set" that are
// unnamed tokens in the grammar rather than fields.
function hasChildText(node, text) {
  return node.children.some((c) => c.text === text);
}

function declarationKind(node) {
  // variable_declaration's first child is the "const"/"let"/"var"
  // keyword token itself (unnamed, so not reachable via a field).
  return node.child(0)?.text || "let";
}

// ------------------------------------------------------------
// Per-function symbol tracking (list/dict/string/number/loop-item/
// function) — same limited-but-useful approach as python.js.
// ------------------------------------------------------------

function roleFromValueNode(valueNode) {
  if (!valueNode) return null;
  if (valueNode.type === "array") return "list";
  if (valueNode.type === "object") return "dict";
  if (valueNode.type === "string" || valueNode.type === "template_string") return "string";
  if (valueNode.type === "number") return "number";
  if (valueNode.type === "true" || valueNode.type === "false") return "boolean";
  if (valueNode.type === "arrow_function" || valueNode.type === "function") return "function";
  if (valueNode.type === "new_expression") {
    const ctorName = valueNode.childForFieldName("constructor")?.text;
    if (ctorName === "Map") return "dict";
    if (ctorName === "Set") return "set";
  }
  return null;
}

function buildSymbols(scopeNode) {
  const symbols = new Map();
  function scan(node) {
    if (node.type === "variable_declarator") {
      const name = node.childForFieldName("name");
      const value = node.childForFieldName("value");
      if (name && name.type === "identifier") {
        const role = roleFromValueNode(value);
        if (role) symbols.set(name.text, role);
      }
    }
    if (node.type === "function_declaration") {
      const name = node.childForFieldName("name");
      if (name) symbols.set(name.text, "function");
    }
    if (node.type === "for_in_statement" && hasChildText(node, "of")) {
      const left = node.childForFieldName("left");
      // `left` may be a bare identifier or a variable_declarator
      // wrapping one (`for (const item of x)`).
      const target = left && left.type === "variable_declarator" ? left.childForFieldName("name") : left;
      if (target && target.type === "identifier") symbols.set(target.text, "loop-item");
    }
    // array.forEach((item) => ...)
    if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      if (fn && fn.type === "member_expression" && fn.childForFieldName("property")?.text === "forEach") {
        const argsNode = node.childForFieldName("arguments");
        const cb = argsNode ? argsNode.namedChildren[0] : null;
        if (cb && (cb.type === "arrow_function" || cb.type === "function")) {
          const params = cb.childForFieldName("parameters") || cb.childForFieldName("parameter");
          const firstParam = params && params.namedChildren ? params.namedChildren[0] : params;
          if (firstParam && firstParam.type === "identifier") symbols.set(firstParam.text, "loop-item");
        }
      }
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
    case "import_statement":
      return "Imports a library, module, or dependency so functionality from another file/package can be used.";

    case "function_declaration": {
      const nameNode = node.childForFieldName("name");
      const paramsNode = node.childForFieldName("parameters");
      const params = paramsNode ? paramsNode.text.slice(1, -1).trim() : "";
      const name = nameNode ? nameNode.text : "?";
      return params
        ? `Defines the function \`${name}\`, which accepts \`${params}\` as parameter(s).`
        : `Defines the function \`${name}\` without parameters.`;
    }

    // `var` produces "variable_declaration"; `const`/`let` produce a
    // DIFFERENT node type, "lexical_declaration" — a tree-sitter-
    // javascript grammar quirk. Both wrap variable_declarator
    // children identically, so one handler covers both.
    case "variable_declaration":
    case "lexical_declaration": {
      const declarator = node.namedChildren.find((c) => c.type === "variable_declarator");
      if (!declarator) return null;
      const keyword = declarationKind(node);
      const name = declarator.childForFieldName("name");
      const value = declarator.childForFieldName("value");

      // Arrow/anonymous function assigned to a variable.
      if (value && (value.type === "arrow_function" || value.type === "function")) {
        const paramsNode = value.childForFieldName("parameters") || value.childForFieldName("parameter");
        const params = paramsNode ? (paramsNode.namedChildren ? paramsNode.namedChildren.map((p) => p.text).join(", ") : paramsNode.text) : "";
        return params
          ? `Defines the arrow function \`${name ? name.text : "?"}\`, which accepts \`${params}\` as parameter(s).`
          : `Defines the arrow function \`${name ? name.text : "?"}\`.`;
      }

      // Destructuring: name is an object_pattern or array_pattern.
      if (name && (name.type === "object_pattern" || name.type === "array_pattern")) {
        const isObject = name.type === "object_pattern";
        const rawNames = name.namedChildren.map((c) => c.text.replace(/^\.\.\./, ""));
        const nameList = rawNames.map((n) => mdCode(n)).join(", ");
        return isObject
          ? `Destructures ${mdCode(value ? value.text : "?")}, pulling out the ${nameList} propert${rawNames.length === 1 ? "y" : "ies"} into new \`${keyword}\` variable(s).`
          : `Destructures ${mdCode(value ? value.text : "?")} by position into new \`${keyword}\` variable(s): ${nameList}.`;
      }

      if (!name || name.type !== "identifier") return null;

      if (value && value.type === "array") {
        const items = value.namedChildren.map((c) => c.text).join(", ");
        return `Creates the \`${keyword}\` array \`${name.text}\`${items ? ` containing ${mdCode(items)}` : " (empty)"}.`;
      }
      if (value && value.type === "object") {
        return `Creates the \`${keyword}\` object \`${name.text}\` with the properties ${mdCode(value.text)}.`;
      }
      return `Declares the \`${keyword}\` variable \`${name.text}\`${value ? ` and assigns it ${mdCode(value.text)}` : ""}.`;
    }

    case "class_declaration": {
      const nameNode = node.childForFieldName("name");
      const heritage = node.namedChildren.find((c) => c.type === "class_heritage");
      const base = heritage ? heritage.namedChildren[0]?.text : null;
      const name = nameNode ? nameNode.text : "?";
      return base
        ? `Defines the class \`${name}\`, which extends \`${base}\` (inherits its properties and methods).`
        : `Defines the class \`${name}\`, which can serve as a blueprint for creating objects.`;
    }

    case "method_definition": {
      const nameNode = node.childForFieldName("name");
      const paramsNode = node.childForFieldName("parameters");
      const params = paramsNode ? paramsNode.text.slice(1, -1).trim() : "";
      const name = nameNode ? nameNode.text : "?";

      if (name === "constructor") {
        return params
          ? `Defines the constructor for this class, which accepts \`${params}\` as parameter(s) and runs when a new instance is created.`
          : "Defines the constructor for this class, which runs when a new instance is created.";
      }

      const isStatic = hasChildText(node, "static");
      const isGet = hasChildText(node, "get");
      const isSet = hasChildText(node, "set");
      const kind = isGet ? "getter" : isSet ? "setter" : "method";
      const staticNote = isStatic ? " (a static method, called on the class itself rather than an instance)" : "";
      return params
        ? `Defines the \`${name}\` ${kind}${staticNote}, which accepts \`${params}\` as parameter(s).`
        : `Defines the \`${name}\` ${kind}${staticNote}.`;
    }

    case "for_in_statement": {
      const isOf = hasChildText(node, "of");
      const left = node.childForFieldName("left");
      const right = node.childForFieldName("right");
      const target = left && left.type === "variable_declarator" ? left.childForFieldName("name") : left;
      const targetText = target ? target.text : "?";
      if (isOf) {
        const sourceText = right ? right.text : "?";
        const role = right && right.type === "identifier" ? symbols.get(right.text) : null;
        const phrase = role === "list" ? `the ${mdCode(sourceText)} array` : mdCode(sourceText);
        return `Iterates over ${phrase}; on each pass, ${mdCode(targetText)} represents the current item.`;
      }
      return `Iterates over the enumerable property names of ${mdCode(right ? right.text : "?")}; on each pass, ${mdCode(targetText)} holds the current key.`;
    }

    case "for_statement":
      return "Starts a counted loop that repeats a block of code a set number of times.";

    case "while_statement": {
      const condition = node.childForFieldName("condition");
      if (condition && condition.text === "true") {
        return "Starts an intentionally infinite loop, which must be exited with a `break` or `return` elsewhere.";
      }
      return "Starts a while loop that keeps running while its condition stays true.";
    }

    case "do_statement":
      return "Starts a do/while loop, which always runs its body at least once before checking the condition.";

    case "if_statement": {
      const condition = node.childForFieldName("condition");
      const conditionText = condition ? condition.text.replace(/^\(|\)$/g, "") : "?";
      const isElseIf = node.parent && node.parent.type === "if_statement" && node.parent.childForFieldName("alternative") === node;
      if (isElseIf) {
        return `Checks another condition (${mdCode(conditionText)}) when the previous one was not met.`;
      }
      if (condition && condition.namedChildren[0]?.type === "identifier") {
        const role = symbols.get(condition.namedChildren[0].text);
        if (role === "number") {
          return `Checks whether the number stored in ${mdCode(condition.namedChildren[0].text)} is truthy before running the code that follows.`;
        }
        if (role === "loop-item") {
          return `Checks whether the current item (${mdCode(condition.namedChildren[0].text)}) is truthy before running the code that follows.`;
        }
      }
      return `Checks whether ${mdCode(conditionText)} is true before running the code that follows.`;
    }

    case "switch_statement": {
      const value = node.childForFieldName("value");
      return `Starts a switch statement that selects a block of code based on the value of ${mdCode(value ? value.text : "?")}.`;
    }

    case "switch_case": {
      const value = node.childForFieldName("value");
      return `Defines one possible case (${mdCode(value ? value.text : "?")}) inside a switch statement.`;
    }

    case "switch_default":
      return "Defines the fallback case inside a switch statement, used when none of the other cases match.";

    case "try_statement":
      return "Starts a `try` block; if an error occurs anywhere inside it, execution jumps to the matching `catch` block below.";

    case "catch_clause": {
      const param = node.childForFieldName("parameter");
      const errName = param ? param.text : null;
      return errName
        ? `Catches any error thrown in the \`try\` block above, made available here as \`${errName}\`.`
        : "Catches any error thrown in the `try` block above.";
    }

    case "statement_block": {
      const parent = node.parent;
      if (parent && parent.type === "if_statement" && parent.childForFieldName("alternative") === node) {
        return "Defines the alternative block that runs when the previous condition is false.";
      }
      if (parent && parent.type === "try_statement" && parent.childForFieldName("finalizer") === node) {
        return "Starts a `finally` block, which always runs after the `try`/`catch`, whether or not an error occurred.";
      }
      return null;
    }

    case "throw_statement": {
      const value = node.namedChildren[0];
      return `Throws an error (${mdCode(value ? value.text : "?")}), stopping normal execution here so it can be caught by an enclosing \`try\`/\`catch\`.`;
    }

    case "return_statement": {
      const value = node.namedChildren[0];
      return value
        ? `Returns ${mdCode(value.text)} from the current function.`
        : "Returns control from the current function without a value.";
    }

    case "update_expression": {
      const arg = node.namedChildren[0];
      const isIncrement = node.text.includes("++");
      return `${isIncrement ? "Increments" : "Decrements"} ${mdCode(arg ? arg.text : "?")} by 1.`;
    }

    case "expression_statement": {
      const inner = node.namedChildren[0];
      if (!inner) return null;

      // console.log/error/warn/info/debug
      if (inner.type === "call_expression") {
        const fn = inner.childForFieldName("function");
        if (fn && fn.type === "member_expression" && fn.childForFieldName("object")?.text === "console") {
          const method = fn.childForFieldName("property")?.text;
          const argsNode = inner.childForFieldName("arguments");
          const arg = argsNode ? argsNode.namedChildren[0] : null;
          const argText = arg ? mdCode(arg.text) : null;
          if (method === "log") {
            return argText ? `Displays ${argText} in the browser/console.` : "Prints a blank line to the console.";
          }
          const verb = { error: "Logs an error", warn: "Logs a warning", info: "Logs an informational message", debug: "Logs a debug message" }[method];
          if (verb) return argText ? `${verb} (${argText}) to the console.` : `${verb} to the console.`;
        }

        // super(...)
        if (fn && fn.text === "super") {
          const argsNode = inner.childForFieldName("arguments");
          const args = argsNode ? argsNode.text.slice(1, -1).trim() : "";
          return args
            ? `Calls the parent class's constructor via \`super()\`, passing ${mdCode(args)}.`
            : "Calls the parent class's constructor via `super()`.";
        }

        // obj.method(args)
        if (fn && fn.type === "member_expression") {
          const obj = fn.childForFieldName("object");
          const prop = fn.childForFieldName("property");
          const argsNode = inner.childForFieldName("arguments");
          const args = argsNode ? argsNode.text.slice(1, -1).trim() : "";
          if (obj && prop) {
            return args
              ? `Calls \`.${prop.text}(${args})\` on ${mdCode(obj.text)}.`
              : `Calls \`.${prop.text}()\` on ${mdCode(obj.text)}.`;
          }
        }

        // bare functionName(args)
        if (fn && fn.type === "identifier") {
          const argsNode = inner.childForFieldName("arguments");
          const hasArgs = argsNode && argsNode.namedChildCount > 0;
          const role = symbols.get(fn.text);
          const label = role === "function" ? `the ${mdCode(fn.text + "()")} function defined above` : mdCode(fn.text + "()");
          return hasArgs ? `Calls ${label} with the provided argument(s).` : `Calls ${label} without arguments.`;
        }
      }

      // Assignment expressions: augmented, increment (handled above via
      // update_expression), and plain property/variable assignment.
      if (inner.type === "assignment_expression") {
        const left = inner.childForFieldName("left");
        const right = inner.childForFieldName("right");
        const operator = inner.childForFieldName("operator")?.text || node.children.find((c) => /^[+\-*/%]?=$/.test(c.text))?.text || "=";

        if (operator !== "=") {
          const opVerbs = {
            "+=": ["Increases", "by"], "-=": ["Decreases", "by"],
            "*=": ["Multiplies", "by"], "/=": ["Divides", "by"],
            "%=": ["Takes the remainder (modulo) of", "by"], "**=": ["Raises", "to the power of"],
          };
          const [verb, prep] = opVerbs[operator] || ["Updates", "by"];
          return `${verb} ${mdCode(left ? left.text : "?")} ${prep} ${mdCode(right ? right.text : "?")}.`;
        }

        if (left && left.type === "member_expression") {
          const propName = left.childForFieldName("property")?.text;
          if (propName === "innerHTML" || propName === "outerHTML") {
            return `Replaces the HTML content of the selected element with ${mdCode(right ? right.text : "?")}. If that value can come from user input, this is an XSS injection risk (see Potential Issues below).`;
          }
          return `Sets ${mdCode(left.text)} to ${mdCode(right ? right.text : "?")}.`;
        }

        return `Sets ${mdCode(left ? left.text : "?")} to ${mdCode(right ? right.text : "?")}.`;
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
  if (node.type === "catch_clause") {
    const body = node.childForFieldName("body");
    if (body && body.namedChildCount === 0) {
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

  if (node.type === "assignment_expression") {
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    if (left && left.type === "member_expression") {
      const propName = left.childForFieldName("property")?.text;
      if ((propName === "innerHTML" || propName === "outerHTML") && right && !(right.type === "string" || right.type === "template_string")) {
        issues.push({
          line: lineOf(node),
          type: "security",
          message: `Assigns a non-literal value to \`${propName}\`. If this value can come from user input, it's a DOM-based XSS risk — consider \`textContent\` or a sanitizer instead.`,
        });
      }
    }
  }

  if (node.type === "call_expression") {
    const fn = node.childForFieldName("function");
    if (fn && fn.type === "member_expression" && fn.childForFieldName("object")?.text === "document" && fn.childForFieldName("property")?.text === "write") {
      issues.push({
        line: lineOf(node),
        type: "security",
        message: "`document.write()` injects raw markup into the page and is a common XSS vector. Prefer safer DOM APIs like `textContent` or `createElement`.",
      });
    }
  }

  if (node.type === "binary_expression" && node.childForFieldName("operator")?.text === "==") {
    issues.push({
      line: lineOf(node),
      type: "review",
      message: "Uses `==` for comparison. `===` (strict equality) is usually safer since it avoids implicit type coercion.",
    });
  }

  if (node.type === "variable_declaration" && declarationKind(node) === "var") {
    issues.push({
      line: lineOf(node),
      type: "review",
      message: "Uses `var`. `let` or `const` have more predictable (block) scoping and are generally preferred.",
    });
  }

  if (node.type === "function_declaration") {
    const body = node.childForFieldName("body");
    if (body && body.namedChildCount === 0) {
      issues.push({
        line: lineOf(node),
        type: "warning",
        message: "This function appears to have no implementation yet.",
      });
    }
    checkUnusedVariables(node, issues);
  }
}

function checkUnusedVariables(funcNode, issues) {
  const assigned = new Map();
  const identifierCounts = new Map();

  function collect(node) {
    if (node.type === "identifier") {
      identifierCounts.set(node.text, (identifierCounts.get(node.text) || 0) + 1);
    }
    if (node.type === "variable_declarator") {
      const name = node.childForFieldName("name");
      if (name && name.type === "identifier" && !assigned.has(name.text)) {
        assigned.set(name.text, lineOf(node));
      }
    }
    for (const child of node.namedChildren) collect(child);
  }
  collect(funcNode);

  for (const [name, line] of assigned) {
    if ((identifierCounts.get(name) || 0) <= 1) {
      issues.push({
        line,
        type: "review",
        message: `Variable \`${name}\` appears to be declared but may not be used later.`,
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
    const nameNode = node.childForFieldName("name");
    const paramsNode = node.childForFieldName("parameters");
    structure.functions.push({
      line: lineNumber,
      name: nameNode ? nameNode.text : "?",
      parameters: paramsNode ? paramsNode.text.slice(1, -1).trim() : "",
    });
  } else if (node.type === "variable_declarator" && node.childForFieldName("value")?.type === "arrow_function") {
    const name = node.childForFieldName("name");
    const value = node.childForFieldName("value");
    const paramsNode = value.childForFieldName("parameters") || value.childForFieldName("parameter");
    const params = paramsNode ? (paramsNode.namedChildren ? paramsNode.namedChildren.map((p) => p.text).join(", ") : paramsNode.text) : "";
    structure.functions.push({ line: lineOf(node), name: name ? name.text : "?", parameters: params });
  } else if (node.type === "class_declaration") {
    const nameNode = node.childForFieldName("name");
    structure.classes.push({ line: lineNumber, name: nameNode ? nameNode.text : "?" });
  } else if (node.type === "import_statement") {
    structure.imports.push(lineNumber);
  } else if (node.type === "variable_declarator") {
    const name = node.childForFieldName("name");
    if (name && name.type === "identifier") {
      structure.variables.push({ line: lineNumber, name: name.text });
    }
  } else if (node.type === "for_statement" || node.type === "for_in_statement" || node.type === "while_statement" || node.type === "do_statement") {
    structure.loops.push(lineNumber);
  } else if (node.type === "if_statement" || node.type === "switch_statement") {
    structure.conditionals.push(lineNumber);
  } else if (node.type === "return_statement") {
    structure.returns.push(lineNumber);
  } else if (node.type === "call_expression" && node.childForFieldName("function")?.type === "member_expression") {
    const fn = node.childForFieldName("function");
    if (fn.childForFieldName("object")?.text === "console") {
      structure.outputs.push(lineNumber);
    }
  }
}

// ------------------------------------------------------------
// Single entry point
// ------------------------------------------------------------

// Exported so typescript.js (whose grammar mirrors JS closely, and
// which shared these exact functions when both were regex-based) can
// reuse this logic wholesale instead of duplicating it, adding only
// its own TS-specific handling (interfaces, type aliases, typed
// declarations, `any` usage) on top.
export { explainNode, checkIssues, updateStructure, buildSymbols, SUPERSEDED_MESSAGES, mdCode, lineOf };

export async function analyzeAst(code) {
  await ensureReady();

  const parser = new Parser();
  parser.setLanguage(JSLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;

  const structure = {
    functions: [], classes: [], imports: [], variables: [],
    loops: [], conditionals: [], returns: [], outputs: [], comments: [],
  };
  const issues = findCommonIssues(code.split("\n")).filter(
    (issue) => !SUPERSEDED_MESSAGES.has(issue.message)
  );
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
    if (explanation) {
      lineExplanations.push({ line: lineOf(node), text: explanation });
    }

    for (const child of node.namedChildren) walk(child, symbols);
  }

  walk(root, buildSymbols(root));

  lineExplanations.sort((a, b) => a.line - b.line);

  return { structure, issues, lineExplanations };
}
