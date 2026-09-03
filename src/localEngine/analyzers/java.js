// ============================================================
// Java analyzer — Tree-sitter (AST) based
// ============================================================
// Same architecture as python.js/javascript.js: single async
// analyzeAst(code) entry point, per-method symbol tracking, shared
// findCommonIssues() merged with the two AST-superseded checks
// filtered out.

import Parser from "web-tree-sitter";
import { findCommonIssues, mdCode } from "../shared/patterns.js";

export const id = "java";
export const label = "Java";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

const WASM_CORE_PATH = isNode
  ? "./node_modules/web-tree-sitter/tree-sitter.wasm"
  : "/wasm/tree-sitter.wasm";
const WASM_JAVA_PATH = isNode
  ? "./node_modules/tree-sitter-wasms/out/tree-sitter-java.wasm"
  : "/wasm/tree-sitter-java.wasm";

export function detect(code) {
  return /\b(public|private|protected)\b/.test(code) && /\b(class|static|void|int|String)\b/.test(code);
}

let JavaLang = null;
let ready = false;

async function ensureReady() {
  if (ready) return;
  await Parser.init(isNode ? undefined : { locateFile: () => WASM_CORE_PATH });
  JavaLang = await Parser.Language.load(WASM_JAVA_PATH);
  ready = true;
}

function lineOf(node) {
  return node.startPosition.row + 1;
}

const COLLECTION_TYPES = /^(ArrayList|List|LinkedList)\s*<.*>$/;
const MAP_TYPES = /^(HashMap|Map|TreeMap)\s*<.*>$/;

function typeRole(typeText) {
  const t = (typeText || "").trim();
  if (COLLECTION_TYPES.test(t)) return "list";
  if (MAP_TYPES.test(t)) return "dict";
  if (t === "String") return "string";
  if (["int", "long", "double", "float", "short", "Integer", "Double"].includes(t)) return "number";
  if (t === "boolean" || t === "Boolean") return "boolean";
  return null;
}

// ------------------------------------------------------------
// Per-method symbol tracking
// ------------------------------------------------------------

function buildSymbols(scopeNode) {
  const symbols = new Map();
  function scan(node) {
    if (node.type === "local_variable_declaration") {
      const typeNode = node.childForFieldName("type");
      const declarator = node.namedChildren.find((c) => c.type === "variable_declarator");
      const name = declarator ? declarator.childForFieldName("name") : null;
      if (name) {
        const role = typeRole(typeNode ? typeNode.text : "");
        if (role) symbols.set(name.text, role);
      }
    }
    if (node.type === "enhanced_for_statement") {
      const name = node.childForFieldName("name");
      if (name) symbols.set(name.text, "loop-item");
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
    case "import_declaration":
      return "Imports a class or package so it can be used in this file.";

    case "class_declaration": {
      const nameNode = node.childForFieldName("name");
      const superclass = node.childForFieldName("superclass");
      const base = superclass ? superclass.namedChildren[0]?.text : null;
      const name = nameNode ? nameNode.text : "?";
      return base
        ? `Defines the class \`${name}\`, which extends \`${base}\` (inherits its members).`
        : `Defines the class \`${name}\`, which can serve as a blueprint for creating objects.`;
    }

    case "method_declaration": {
      const nameNode = node.childForFieldName("name");
      const paramsNode = node.childForFieldName("parameters");
      const typeNode = node.childForFieldName("type");
      const params = paramsNode ? paramsNode.text.slice(1, -1).trim() : "";
      const name = nameNode ? nameNode.text : "?";
      const returnType = typeNode ? typeNode.text : "void";
      return params
        ? `Defines the method \`${name}\`, which accepts ${mdCode(params)} and returns ${mdCode(returnType)}.`
        : `Defines the method \`${name}\`, which returns ${mdCode(returnType)} and takes no parameters.`;
    }

    case "constructor_declaration": {
      const paramsNode = node.childForFieldName("parameters");
      const params = paramsNode ? paramsNode.text.slice(1, -1).trim() : "";
      return params
        ? `Defines the constructor for this class, which accepts ${mdCode(params)} and runs when a new instance is created.`
        : "Defines the constructor for this class, which runs when a new instance is created.";
    }

    case "enhanced_for_statement": {
      const name = node.childForFieldName("name");
      const value = node.childForFieldName("value");
      const valueText = value ? value.text : "?";
      const role = value && value.type === "identifier" ? symbols.get(value.text) : null;
      const phrase = role === "list" ? `the ${mdCode(valueText)} list` : mdCode(valueText);
      return `Iterates over ${phrase}; on each pass, ${mdCode(name ? name.text : "?")} represents the current item.`;
    }

    case "for_statement":
      return "Starts a counted loop that repeats a block of code a set number of times.";

    case "while_statement": {
      const condition = node.childForFieldName("condition");
      if (condition && condition.text === "(true)") {
        return "Starts an intentionally infinite loop, which must be exited with a `break` or `return` elsewhere.";
      }
      return "Starts a while loop that keeps running while its condition stays true.";
    }

    case "if_statement": {
      const condition = node.childForFieldName("condition");
      const conditionText = condition ? condition.text.replace(/^\(|\)$/g, "") : "?";
      const isElseIf = node.parent && node.parent.type === "if_statement" && node.parent.childForFieldName("alternative") === node;
      if (isElseIf) {
        return `Checks another condition (${mdCode(conditionText)}) when the previous one was not met.`;
      }
      if (condition && condition.namedChildren[0]?.type === "identifier") {
        const role = symbols.get(condition.namedChildren[0].text);
        if (role === "list") {
          return `Checks whether the ${mdCode(conditionText)} list is non-empty before running the code that follows.`;
        }
        if (role === "number") {
          return `Checks whether the number stored in ${mdCode(conditionText)} is truthy before running the code that follows.`;
        }
        if (role === "loop-item") {
          return `Checks whether the current item (${mdCode(conditionText)}) is truthy before running the code that follows.`;
        }
      }
      return `Checks whether ${mdCode(conditionText)} is true before running the code that follows.`;
    }

    case "block": {
      const parent = node.parent;
      if (parent && parent.type === "if_statement" && parent.childForFieldName("alternative") === node) {
        return "Defines the alternative block that runs when the previous condition is false.";
      }
      // Allman style: the `{` sits alone on its own line, separate
      // from the construct that owns it (method signature, if/for/
      // while header, try, etc.) — nothing else would explain that
      // line, so it's worth one of its own. In the far more common
      // K&R style the block starts on the same line as its owner,
      // which is already explained there — skip it then to avoid a
      // redundant second entry for that same line.
      if (parent && lineOf(node) !== lineOf(parent)) {
        return "Opens a new block of code.";
      }
      return null;
    }

    case "try_statement":
      return "Starts a `try` block; if an error occurs anywhere inside it, execution jumps to the matching `catch` block below.";

    case "finally_clause":
      return "Starts a `finally` block, which always runs after the `try`/`catch`, whether or not an error occurred.";

    case "catch_clause": {
      const param = node.namedChildren.find((c) => c.type === "catch_formal_parameter");
      const name = param ? param.namedChildren[param.namedChildren.length - 1]?.text : null;
      return name
        ? `Catches an exception raised in the \`try\` block above, made available here as \`${name}\`.`
        : "Catches an exception raised in the `try` block above.";
    }

    case "return_statement": {
      const value = node.namedChildren[0];
      return value
        ? `Returns ${mdCode(value.text)} from the current method.`
        : "Returns control from the current method (void).";
    }

    case "local_variable_declaration": {
      const typeNode = node.childForFieldName("type");
      const declarator = node.namedChildren.find((c) => c.type === "variable_declarator");
      if (!declarator) return null;
      const name = declarator.childForFieldName("name");
      const value = declarator.childForFieldName("value");
      const typeText = typeNode ? typeNode.text : "var";
      return value
        ? `Declares a ${mdCode(typeText)} variable ${mdCode(name ? name.text : "?")} and assigns it ${mdCode(value.text)}.`
        : `Declares a ${mdCode(typeText)} variable ${mdCode(name ? name.text : "?")}.`;
    }

    case "expression_statement": {
      const inner = node.namedChildren[0];
      if (!inner) return null;

      if (inner.type === "method_invocation") {
        const obj = inner.childForFieldName("object");
        const name = inner.childForFieldName("name");
        const argsNode = inner.childForFieldName("arguments");
        const args = argsNode ? argsNode.text.slice(1, -1).trim() : "";

        // System.out.println/print
        if (obj && obj.type === "field_access" && obj.text === "System.out") {
          return args ? `Prints ${mdCode(args)} to the console.` : "Prints a blank line to the console.";
        }

        if (obj) {
          return args
            ? `Calls \`.${name.text}(${args})\` on ${mdCode(obj.text)}.`
            : `Calls \`.${name.text}()\` on ${mdCode(obj.text)}.`;
        }
        return args
          ? `Calls \`${name.text}()\` with the provided argument(s).`
          : `Calls \`${name.text}()\` without passing any arguments.`;
      }

      if (inner.type === "assignment_expression") {
        const left = inner.childForFieldName("left");
        const right = inner.childForFieldName("right");
        const operator = inner.childForFieldName("operator")?.text || "=";
        if (operator !== "=") {
          const opVerbs = {
            "+=": ["Increases", "by"], "-=": ["Decreases", "by"],
            "*=": ["Multiplies", "by"], "/=": ["Divides", "by"],
          };
          const [verb, prep] = opVerbs[operator] || ["Updates", "by"];
          return `${verb} ${mdCode(left ? left.text : "?")} ${prep} ${mdCode(right ? right.text : "?")}.`;
        }
        return `Sets ${mdCode(left ? left.text : "?")} to ${mdCode(right ? right.text : "?")}.`;
      }

      if (inner.type === "update_expression") {
        const isIncrement = inner.text.includes("++");
        const target = inner.namedChildren[0];
        return `${isIncrement ? "Increments" : "Decrements"} ${mdCode(target ? target.text : "?")} by 1.`;
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
    const param = node.namedChildren.find((c) => c.type === "catch_formal_parameter");
    if (param && param.text.includes("Exception ") && !param.text.includes("RuntimeException")) {
      issues.push({
        line: lineOf(node),
        type: "warning",
        message: "Catches the broad `Exception` type. Catching more specific exceptions is usually safer.",
      });
    }
  }

  if (node.type === "return_statement") {
    const next = node.nextNamedSibling;
    if (next && next.type !== "line_comment" && next.type !== "block_comment") {
      issues.push({
        line: lineOf(next),
        type: "warning",
        message: "This line comes right after a `return` in the same block, so it can never be reached.",
      });
    }
  }

  if (node.type === "binary_expression" && node.childForFieldName("operator")?.text === "==") {
    const right = node.childForFieldName("right");
    const left = node.childForFieldName("left");
    if ((right && right.type === "string_literal") || (left && left.type === "string_literal")) {
      issues.push({
        line: lineOf(node),
        type: "review",
        message: "Compares a `String` using `==`, which checks reference equality, not content. Use `.equals()` instead.",
      });
    }
  }

  if (node.type === "method_invocation") {
    const obj = node.childForFieldName("object");
    const name = node.childForFieldName("name")?.text;
    const argsNode = node.childForFieldName("arguments");
    const hasConcat = argsNode && argsNode.namedChildren.some((a) => a.type === "binary_expression" && a.childForFieldName("operator")?.text === "+");

    if (obj && obj.text === "Runtime.getRuntime()" && name === "exec" && hasConcat) {
      issues.push({
        line: lineOf(node),
        type: "security",
        message: "`Runtime.exec()` is called with a concatenated string. If any part comes from user input, this is a command-injection risk — pass arguments as a `String[]` instead.",
      });
    }
    if (name === "readObject") {
      issues.push({
        line: lineOf(node),
        type: "security",
        message: "Deserializing with `ObjectInputStream`/`readObject()` on untrusted data can lead to remote code execution. Avoid deserializing data from an untrusted source.",
      });
    }
  }

  if (node.type === "object_creation_expression") {
    const type = node.childForFieldName("type")?.text;
    const argsNode = node.childForFieldName("arguments");
    const hasConcat = argsNode && argsNode.namedChildren.some((a) => a.type === "binary_expression" && a.childForFieldName("operator")?.text === "+");
    if (type === "ProcessBuilder" && hasConcat) {
      issues.push({
        line: lineOf(node),
        type: "security",
        message: "`ProcessBuilder` is constructed with a concatenated argument. If any part comes from user input, this is a command-injection risk.",
      });
    }
  }
}

function checkUnusedVariables(scopeNode, issues) {
  const assigned = new Map();
  const identifierCounts = new Map();

  function collect(node) {
    if (node.type === "identifier") {
      identifierCounts.set(node.text, (identifierCounts.get(node.text) || 0) + 1);
    }
    if (node.type === "variable_declarator") {
      const name = node.childForFieldName("name");
      if (name && !assigned.has(name.text)) assigned.set(name.text, lineOf(node));
    }
    for (const child of node.namedChildren) collect(child);
  }
  collect(scopeNode);

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

  if (node.type === "line_comment" || node.type === "block_comment") {
    structure.comments.push(lineNumber);
  } else if (node.type === "method_declaration") {
    const nameNode = node.childForFieldName("name");
    const paramsNode = node.childForFieldName("parameters");
    structure.functions.push({
      line: lineNumber,
      name: nameNode ? nameNode.text : "?",
      parameters: paramsNode ? paramsNode.text.slice(1, -1).trim() : "",
    });
  } else if (node.type === "class_declaration") {
    const nameNode = node.childForFieldName("name");
    structure.classes.push({ line: lineNumber, name: nameNode ? nameNode.text : "?" });
  } else if (node.type === "import_declaration") {
    structure.imports.push(lineNumber);
  } else if (node.type === "variable_declarator") {
    const name = node.childForFieldName("name");
    if (name) structure.variables.push({ line: lineNumber, name: name.text });
  } else if (node.type === "for_statement" || node.type === "enhanced_for_statement" || node.type === "while_statement") {
    structure.loops.push(lineNumber);
  } else if (node.type === "if_statement") {
    structure.conditionals.push(lineNumber);
  } else if (node.type === "return_statement") {
    structure.returns.push(lineNumber);
  } else if (node.type === "method_invocation" && node.childForFieldName("object")?.text === "System.out") {
    structure.outputs.push(lineNumber);
  }
}

// ------------------------------------------------------------
// Single entry point
// ------------------------------------------------------------

export async function analyzeAst(code) {
  await ensureReady();

  const parser = new Parser();
  parser.setLanguage(JavaLang);
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

    if (node.type === "method_declaration" || node.type === "constructor_declaration") {
      const explanation = explainNode(node, symbols);
      if (explanation) lineExplanations.push({ line: lineOf(node), text: explanation });
      const body = node.childForFieldName("body");
      const localSymbols = buildSymbols(body);
      checkUnusedVariables(body || node, issues);
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
