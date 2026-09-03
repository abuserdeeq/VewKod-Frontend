// ============================================================
// C# analyzer — Tree-sitter (AST) based
// ============================================================

import Parser from "web-tree-sitter";
import { findCommonIssues, mdCode } from "../shared/patterns.js";

export const id = "csharp";
export const label = "C#";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

const WASM_CORE_PATH = isNode
  ? "./node_modules/web-tree-sitter/tree-sitter.wasm"
  : "/wasm/tree-sitter.wasm";
const WASM_CSHARP_PATH = isNode
  ? "./node_modules/tree-sitter-wasms/out/tree-sitter-c_sharp.wasm"
  : "/wasm/tree-sitter-c_sharp.wasm";

export function detect(code) {
  return /\busing\s+System\b/.test(code) || /\bConsole\.(Write|WriteLine)\s*\(/.test(code) || /\bnamespace\s+\w+/.test(code);
}

let CSharpLang = null;
let ready = false;

async function ensureReady() {
  if (ready) return;
  await Parser.init(isNode ? undefined : { locateFile: () => WASM_CORE_PATH });
  CSharpLang = await Parser.Language.load(WASM_CSHARP_PATH);
  ready = true;
}

function lineOf(node) {
  return node.startPosition.row + 1;
}

const COLLECTION_TYPES = /^(List|IList|IEnumerable)\s*<.*>$/;
const MAP_TYPES = /^(Dictionary|IDictionary)\s*<.*>$/;

function typeRole(typeText) {
  const t = (typeText || "").trim();
  if (COLLECTION_TYPES.test(t) || t.endsWith("[]")) return "list";
  if (MAP_TYPES.test(t)) return "dict";
  if (t === "string") return "string";
  if (["int", "long", "double", "float", "decimal", "short"].includes(t)) return "number";
  if (t === "bool") return "boolean";
  return null;
}

// ------------------------------------------------------------
// Per-method symbol tracking
// ------------------------------------------------------------

function buildSymbols(scopeNode) {
  const symbols = new Map();
  function scan(node) {
    if (node.type === "variable_declarator") {
      const parent = node.parent;
      const typeNode = parent && parent.type === "variable_declaration" ? parent.childForFieldName("type") : null;
      const name = node.childForFieldName("name");
      if (name && typeNode) {
        const role = typeRole(typeNode.text);
        if (role) symbols.set(name.text, role);
      }
    }
    if (node.type === "foreach_statement") {
      const name = node.childForFieldName("left") || node.childForFieldName("name");
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
    case "using_directive": {
      // `using System;` (import form). The resource-scope form
      // `using (x) { }` is a completely different node type
      // (using_statement), handled separately below.
      return "Imports a namespace so its classes/functions can be used without full qualification.";
    }

    case "using_statement": {
      const resource = node.namedChildren.find((c) => c.type !== "block");
      return `Opens ${mdCode(resource ? resource.text : "?")} and guarantees it will be disposed (its \`Dispose()\` called) as soon as this block ends, even if an exception is thrown.`;
    }

    case "class_declaration": {
      const nameNode = node.childForFieldName("name");
      const bases = node.childForFieldName("bases");
      const base = bases ? bases.namedChildren[0]?.text : null;
      const name = nameNode ? nameNode.text : "?";
      return base
        ? `Defines the class \`${name}\`, which extends/implements \`${base}\`.`
        : `Defines the class \`${name}\`, which can serve as a blueprint for creating objects.`;
    }

    case "method_declaration": {
      const nameNode = node.childForFieldName("name");
      const paramsNode = node.childForFieldName("parameters");
      const typeNode = node.childForFieldName("returns") || node.childForFieldName("type");
      const params = paramsNode ? paramsNode.text.slice(1, -1).trim() : "";
      const name = nameNode ? nameNode.text : "?";
      const returnType = typeNode ? typeNode.text : "void";
      return params
        ? `Defines the method \`${name}\`, which accepts ${mdCode(params)} and returns ${mdCode(returnType)}.`
        : `Defines the method \`${name}\`, which returns ${mdCode(returnType)} and takes no parameters.`;
    }

    case "local_function_statement": {
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

    case "foreach_statement": {
      const name = node.childForFieldName("left") || node.childForFieldName("name");
      const right = node.childForFieldName("right");
      const rightText = right ? right.text : "?";
      const role = right && right.type === "identifier" ? symbols.get(right.text) : null;
      const phrase = role === "list" ? `the ${mdCode(rightText)} collection` : mdCode(rightText);
      return `Iterates over ${phrase}; on each pass, ${mdCode(name ? name.text : "?")} represents the current item.`;
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

    case "if_statement": {
      const condition = node.childForFieldName("condition");
      const conditionText = condition ? condition.text.replace(/^\(|\)$/g, "") : "?";
      const isElseIf = node.parent && node.parent.type === "else_clause";
      return isElseIf
        ? `Checks another condition (${mdCode(conditionText)}) when the previous one was not met.`
        : `Checks whether ${mdCode(conditionText)} is true before running the code that follows.`;
    }

    case "else_clause": {
      // else_clause directly wraps either another if_statement
      // (else-if, handled above) or a block (plain else).
      const inner = node.namedChildren[0];
      if (inner && inner.type === "if_statement") return null; // let the nested if_statement explain itself
      return "Defines the alternative block that runs when the previous condition is false.";
    }

    case "catch_clause": {
      const decl = node.namedChildren.find((c) => c.type === "catch_declaration");
      const name = decl ? decl.namedChildren.find((c) => c.type === "identifier")?.text : null;
      return name
        ? `Catches an exception raised in the \`try\` block above, made available here as \`${name}\`.`
        : "Catches an exception raised in the `try` block above.";
    }

    case "block": {
      const parent = node.parent;
      if (parent && (parent.type === "method_declaration" || parent.type === "constructor_declaration" || parent.type === "local_function_statement" || parent.type === "class_declaration" || parent.type === "using_statement" || parent.type === "if_statement" || parent.type === "while_statement" || parent.type === "for_statement" || parent.type === "foreach_statement")) {
        if (node.startPosition.row > parent.startPosition.row) {
          return "Opens a new block of code.";
        }
      }
      return null;
    }

    case "return_statement": {
      const value = node.namedChildren[0];
      return value
        ? `Returns ${mdCode(value.text)} from the current method.`
        : "Returns control from the current method (void).";
    }

    case "local_declaration_statement": {
      const declaration = node.namedChildren.find((c) => c.type === "variable_declaration");
      if (!declaration) return null;
      const typeNode = declaration.childForFieldName("type");
      const declarator = declaration.namedChildren.find((c) => c.type === "variable_declarator");
      if (!declarator) return null;
      const name = declarator.childForFieldName("name");
      const value = declarator.childForFieldName("value") || declarator.namedChildren.find((c) => c.type !== "identifier");
      const typeText = typeNode ? typeNode.text : "var";
      return value
        ? `Declares a ${mdCode(typeText)} variable ${mdCode(name ? name.text : "?")} and assigns it ${mdCode(value.text)}.`
        : `Declares a ${mdCode(typeText)} variable ${mdCode(name ? name.text : "?")}.`;
    }

    case "expression_statement": {
      const inner = node.namedChildren[0];
      if (!inner) return null;

      if (inner.type === "invocation_expression") {
        const fn = inner.childForFieldName("function");
        const argsNode = inner.childForFieldName("arguments");
        const args = argsNode ? argsNode.text.slice(1, -1).trim() : "";

        if (fn && fn.type === "member_access_expression" && fn.text.startsWith("Console.")) {
          const method = fn.childForFieldName("name")?.text;
          const trailing = method === "WriteLine" ? " with a trailing newline" : "";
          return args ? `Prints ${mdCode(args)} to the console${trailing}.` : "Prints a blank line to the console.";
        }

        if (fn && fn.type === "member_access_expression") {
          const obj = fn.childForFieldName("expression");
          const name = fn.childForFieldName("name");
          return args
            ? `Calls \`.${name.text}(${args})\` on ${mdCode(obj ? obj.text : "?")}.`
            : `Calls \`.${name.text}()\` on ${mdCode(obj ? obj.text : "?")}.`;
        }
        return args
          ? `Calls \`${fn ? fn.text : "?"}()\` with the provided argument(s).`
          : `Calls \`${fn ? fn.text : "?"}()\` without arguments.`;
      }

      if (inner.type === "assignment_expression") {
        const left = inner.childForFieldName("left");
        const right = inner.childForFieldName("right");
        const operator = node.text.match(/([+\-*/]?=)/)?.[1] || "=";
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

      if (inner.type === "postfix_unary_expression" || inner.type === "prefix_unary_expression") {
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
    const decl = node.namedChildren.find((c) => c.type === "catch_declaration");
    if (decl && /\bException\b/.test(decl.text) && !/\w+Exception\w/.test(decl.text.replace("Exception", ""))) {
      if (/\(\s*Exception\b/.test(decl.text)) {
        issues.push({
          line: lineOf(node),
          type: "warning",
          message: "Catches the broad `Exception` type. Catching more specific exceptions is usually safer.",
        });
      }
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

  if (node.type === "invocation_expression") {
    const fn = node.childForFieldName("function");
    const argsNode = node.childForFieldName("arguments");
    const hasConcat = argsNode && argsNode.text.includes("+");

    if (fn && fn.text === "Process.Start" && hasConcat) {
      issues.push({
        line: lineOf(node),
        type: "security",
        message: "`Process.Start()` is called with a concatenated argument. If any part comes from user input, this is a command-injection risk.",
      });
    }
    if (fn && fn.type === "member_access_expression" && fn.childForFieldName("name")?.text === "Deserialize") {
      issues.push({
        line: lineOf(node),
        type: "security",
        message: "`BinaryFormatter`/` .Deserialize()` on untrusted data can lead to remote code execution. Prefer a data-only format like JSON, and avoid `BinaryFormatter` entirely (it's deprecated for security reasons).",
      });
    }
  }

  if (node.type === "object_creation_expression" && node.childForFieldName("type")?.text === "BinaryFormatter") {
    issues.push({
      line: lineOf(node),
      type: "security",
      message: "`BinaryFormatter`/` .Deserialize()` on untrusted data can lead to remote code execution. Prefer a data-only format like JSON, and avoid `BinaryFormatter` entirely (it's deprecated for security reasons).",
    });
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

  if (node.type === "comment") {
    structure.comments.push(lineNumber);
  } else if (node.type === "method_declaration" || node.type === "local_function_statement") {
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
  } else if (node.type === "using_directive") {
    structure.imports.push(lineNumber);
  } else if (node.type === "variable_declarator") {
    const name = node.childForFieldName("name");
    if (name) structure.variables.push({ line: lineNumber, name: name.text });
  } else if (node.type === "for_statement" || node.type === "foreach_statement" || node.type === "while_statement") {
    structure.loops.push(lineNumber);
  } else if (node.type === "if_statement") {
    structure.conditionals.push(lineNumber);
  } else if (node.type === "return_statement") {
    structure.returns.push(lineNumber);
  } else if (node.type === "invocation_expression" && node.childForFieldName("function")?.text?.startsWith("Console.")) {
    structure.outputs.push(lineNumber);
  }
}

// ------------------------------------------------------------
// Single entry point
// ------------------------------------------------------------

export async function analyzeAst(code) {
  await ensureReady();

  const parser = new Parser();
  parser.setLanguage(CSharpLang);
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

    if (node.type === "method_declaration" || node.type === "constructor_declaration" || node.type === "local_function_statement") {
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
