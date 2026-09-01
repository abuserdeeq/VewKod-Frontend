// ============================================================
// PILOT — Tree-sitter-based Python LINE-BY-LINE EXPLAINER
// ============================================================
// This is the bigger half of the full replacement: the regex-based
// explainLine() in analyzers/python.js is ~210 lines covering ~20
// statement categories. This ports the majority of that coverage to
// real AST node types instead of regex-on-text. A few rarer patterns
// from the original (multi-assignment, comprehensions, ternaries,
// super() calls, augmented assignment) are deliberately left for a
// follow-up pass — this first version targets the statement types
// that make up the bulk of real code: def/class, for/while,
// if/elif/else, try/except/finally, raise, return, print (incl.
// f-strings), plain assignment, and function/method calls.
//
// Unlike the issues/structure pilot (which returns aggregate lists),
// this returns ONE explanation per source line that contains a
// statement, as {line, text} entries — the same per-line contract
// engineRunner.js needs to build the "Line-by-Line Explanation"
// section.

import Parser from "web-tree-sitter";

let PythonLang = null;
let ready = false;

async function ensureReady(wasmPaths) {
  if (ready) return;
  await Parser.init();
  PythonLang = await Parser.Language.load(wasmPaths.python);
  ready = true;
}

function mdCode(text) {
  return `\`${text}\``;
}

function lineOf(node) {
  return node.startPosition.row + 1;
}

// Best-effort: does this expression look like a range() call, so the
// for-loop phrasing can call out "a sequence of numbers" specifically?
function isRangeCall(node) {
  return node.type === "call" && node.childForFieldName("function")?.text === "range";
}

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
      // `except Exception as e:` is wrapped as a single "as_pattern"
      // node (type + alias together), not two separate direct
      // children of except_clause — confirmed by output showing the
      // whole "Exception as e" text as one piece. Drill into
      // as_pattern's own children to separate them.
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

      // print(...) — including f-string argument detection.
      if (inner.type === "call" && inner.childForFieldName("function")?.text === "print") {
        const argsNode = inner.childForFieldName("arguments");
        const arg = argsNode ? argsNode.namedChildren[0] : null;
        if (!arg) return "Prints a blank line as program output.";
        if (arg.type === "string" && arg.text.match(/^[fF]["']/)) {
          return `Displays a formatted message, embedding the enclosed expressions into the text.`;
        }
        return `Displays ${mdCode(arg.text)} as program output.`;
      }

      // obj.method(args)
      if (inner.type === "call" && inner.childForFieldName("function")?.type === "attribute") {
        const fn = inner.childForFieldName("function");
        const obj = fn.childForFieldName("object");
        const attr = fn.childForFieldName("attribute");
        const argsNode = inner.childForFieldName("arguments");
        const args = argsNode ? argsNode.text.slice(1, -1).trim() : "";
        return args
          ? `Calls \`.${attr.text}(${args})\` on ${mdCode(obj.text)}.`
          : `Calls \`.${attr.text}()\` on ${mdCode(obj.text)}.`;
      }

      // plain_function(args)
      if (inner.type === "call") {
        const fnName = inner.childForFieldName("function")?.text || "?";
        const argsNode = inner.childForFieldName("arguments");
        const hasArgs = argsNode && argsNode.namedChildCount > 0;
        return hasArgs
          ? `Calls \`${fnName}()\` with the provided argument(s).`
          : `Calls \`${fnName}()\` without arguments.`;
      }

      // Plain assignment: name = value (augmented/multi-assign not
      // yet special-cased — falls through to this generic phrasing).
      if (inner.type === "assignment") {
        const left = inner.childForFieldName("left");
        const right = inner.childForFieldName("right");
        if (left && left.type === "attribute") {
          return `Sets the attribute ${mdCode(left.text)} to ${mdCode(right ? right.text : "?")}.`;
        }
        return `Assigns ${mdCode(right ? right.text : "?")} to the variable ${mdCode(left ? left.text : "?")}.`;
      }

      return null; // fall through to generic fallback below
    }

    default:
      return null;
  }
}

/**
 * Walks the AST and returns one explanation per statement-bearing
 * line, as an array of { line, text } sorted by line number.
 */
export async function explainPythonLines(sourceCode, wasmPaths) {
  await ensureReady(wasmPaths);

  const parser = new Parser();
  parser.setLanguage(PythonLang);
  const tree = parser.parse(sourceCode);

  const results = [];

  function walk(node) {
    const explanation = explainNode(node);
    if (explanation) {
      results.push({ line: lineOf(node), text: explanation });
    }
    for (const child of node.namedChildren) walk(child);
  }

  walk(tree.rootNode);

  results.sort((a, b) => a.line - b.line);
  return results;
}

// SETUP: same as pythonTreeSitter.js — web-tree-sitter@0.22.6 +
// node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm
