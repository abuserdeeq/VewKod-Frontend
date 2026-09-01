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

      // obj.method(args) — including the special case of
      // super().method(args), which reads better with its own phrasing.
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

      // plain_function(args)
      if (inner.type === "call") {
        const fnName = inner.childForFieldName("function")?.text || "?";
        const argsNode = inner.childForFieldName("arguments");
        const hasArgs = argsNode && argsNode.namedChildCount > 0;
        return hasArgs
          ? `Calls \`${fnName}()\` with the provided argument(s).`
          : `Calls \`${fnName}()\` without arguments.`;
      }

      // Plain assignment: name = value. Also covers augmented
      // assignment, multi/parallel assignment, comprehensions, and
      // ternary conditional expressions used as the assigned value —
      // each checked via its own distinct AST node type rather than
      // regex, then falling through to the generic case last.
      if (inner.type === "augmented_assignment") {
        const left = inner.childForFieldName("left");
        const opNode = inner.child(1); // operator token sits between left and right
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

        // Multiple/parallel assignment: `a, b = b, a` or `x, y = 1, 2`
        // — left is a pattern_list (more than one target).
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

        // Comprehensions used as the assigned value.
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

        // Ternary/conditional expression used as the assigned value:
        // `status = "adult" if age >= 18 else "minor"`.
        if (right && right.type === "conditional_expression") {
          const name = left ? left.text : "?";
          const [whenTrue, condition, whenFalse] = right.namedChildren;
          if (whenTrue && condition && whenFalse) {
            return `Assigns ${mdCode(name)} to ${mdCode(whenTrue.text)} if ${mdCode(condition.text)} is true, otherwise ${mdCode(whenFalse.text)} — a conditional (ternary) expression.`;
          }
        }

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

/**
 * Same categories as the existing regex-based analyzeStructure():
 * functions, classes, imports, variables, loops, conditionals,
 * returns, outputs, comments — each a list of {line, name} (or just
 * line numbers where no name applies). Used for the "Structure
 * Breakdown" and "Overview" counts sections.
 */
export async function analyzePythonStructure(sourceCode, wasmPaths) {
  await ensureReady(wasmPaths);

  const parser = new Parser();
  parser.setLanguage(PythonLang);
  const tree = parser.parse(sourceCode);

  const result = {
    functions: [], classes: [], imports: [], variables: [],
    loops: [], conditionals: [], returns: [], outputs: [], comments: [],
  };

  function addVariableTargets(node, lineNumber) {
    // Handles a single identifier target, or a pattern_list from
    // multiple/parallel assignment (`a, b = ...`).
    if (!node) return;
    if (node.type === "identifier") {
      result.variables.push({ line: lineNumber, name: node.text });
    } else if (node.type === "pattern_list") {
      for (const child of node.namedChildren) {
        if (child.type === "identifier") result.variables.push({ line: lineNumber, name: child.text });
      }
    }
    // attribute targets (self.x = ...) deliberately excluded, same
    // as the original regex version only matching bare identifiers.
  }

  function walk(node) {
    const lineNumber = lineOf(node);

    if (node.type === "comment") {
      result.comments.push(lineNumber);
    } else if (node.type === "function_definition") {
      const nameNode = node.childForFieldName("name");
      const paramsNode = node.childForFieldName("parameters");
      result.functions.push({
        line: lineNumber,
        name: nameNode ? nameNode.text : "?",
        parameters: paramsNode ? paramsNode.text.slice(1, -1).trim() : "",
      });
    } else if (node.type === "class_definition") {
      const nameNode = node.childForFieldName("name");
      result.classes.push({ line: lineNumber, name: nameNode ? nameNode.text : "?" });
    } else if (node.type === "import_statement" || node.type === "import_from_statement") {
      result.imports.push(lineNumber);
    } else if (node.type === "assignment") {
      addVariableTargets(node.childForFieldName("left"), lineNumber);
    } else if (node.type === "augmented_assignment") {
      addVariableTargets(node.childForFieldName("left"), lineNumber);
    } else if (node.type === "for_statement" || node.type === "while_statement") {
      result.loops.push(lineNumber);
    } else if (node.type === "if_statement" || node.type === "elif_clause" || node.type === "else_clause") {
      result.conditionals.push(lineNumber);
    } else if (node.type === "return_statement") {
      result.returns.push(lineNumber);
    } else if (node.type === "call" && node.childForFieldName("function")?.text === "print") {
      result.outputs.push(lineNumber);
    }

    for (const child of node.namedChildren) walk(child);
  }

  walk(tree.rootNode);

  return result;
}

// SETUP: same as pythonTreeSitter.js — web-tree-sitter@0.22.6 +
// node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm
