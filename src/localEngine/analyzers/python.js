import { isCommentLine, commentExplanation, findCommonIssues, countUsages, genericFallbackExplanation } from "../shared/patterns.js";

export const id = "python";
export const label = "Python";

export function detect(code) {
  // Require Python's distinctive `def name(...):` header (colon after
  // the parameter list) rather than a bare `def`/`print` keyword —
  // those also appear in Ruby (`def greet`) and Swift (`print(x)`).
  const hasPythonDef = /^\s*def\s+\w+\s*\([^)]*\)\s*:\s*$/m.test(code);
  const hasElif = /\belif\b/.test(code);
  const hasColonBlocks = /:\s*(#.*)?$/m.test(code) && !/[{};]/.test(code);
  return hasPythonDef || hasElif || hasColonBlocks;
}

// ------------------------------------------------------------
// Symbol table construction
// ------------------------------------------------------------

function literalRole(value) {
  const v = value.trim();
  if (/^\[.*\]$/s.test(v)) return "list";
  if (/^\{.*:.*\}$/s.test(v)) return "dict";
  if (/^\{.*\}$/s.test(v)) return "set";
  if (/^["'].*["']$/.test(v)) return "string";
  if (/^(True|False)$/.test(v)) return "boolean";
  if (/^-?\d+(\.\d+)?$/.test(v)) return "number";
  if (/^(list|dict|set)\(\s*\)$/.test(v)) return { list: "list", dict: "dict", set: "set" }[v.match(/^(list|dict|set)/)[1]];
  return "variable";
}

export function buildSymbolTable(lines, symbolTable) {
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || isCommentLine(line)) return;

    // def name(params):
    const fn = line.match(/^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) {
      symbolTable.add(fn[1], "function", { parameters: fn[2].trim() });
      fn[2].split(",").map((p) => p.trim().split("=")[0].trim()).filter(Boolean).forEach((p) => {
        if (p !== "self") symbolTable.add(p, "parameter");
      });
    }

    // class Name
    const cls = line.match(/^class\s+([A-Za-z_]\w*)/);
    if (cls) symbolTable.add(cls[1], "class");

    // for X in Y:   /   for X, Y in Z.items():
    const forLoop = line.match(/^for\s+(.+?)\s+in\s+(.+?)\s*:/);
    if (forLoop) {
      const targets = forLoop[1].split(",").map((t) => t.trim());
      const sourceExpr = forLoop[2].trim();
      const sourceName = sourceExpr.split(/[.(]/)[0].trim();
      const sourceInfo = symbolTable.get(sourceName);

      if (/^range\s*\(/.test(sourceExpr)) {
        targets.forEach((t) => symbolTable.add(t, "loop-item", { of: "range(...)", ofType: "number sequence" }));
      } else {
        const ofType = sourceInfo ? sourceInfo.role : "collection";
        targets.forEach((t) =>
          symbolTable.add(t, "loop-item", { of: sourceName, ofType })
        );
      }
    }

    // plain assignment: name = value  (skip comparisons / keywords)
    const assign = line.match(/^([A-Za-z_]\w*)\s*=\s*(?!=)(.+)$/);
    if (assign && !/^(if|elif|while|for|return|def|class)\b/.test(line)) {
      const name = assign[1];
      const role = literalRole(assign[2]);
      symbolTable.add(name, role);
    }
  });

  return symbolTable;
}

// ------------------------------------------------------------
// Structure overview (counts used in the "Overview" section)
// ------------------------------------------------------------

export function analyzeStructure(lines) {
  const result = {
    functions: [], classes: [], imports: [], variables: [],
    loops: [], conditionals: [], returns: [], outputs: [], comments: [],
  };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;

    if (isCommentLine(line)) result.comments.push(lineNumber);

    const fn = line.match(/^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) result.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });

    const cls = line.match(/^class\s+([A-Za-z_]\w*)/);
    if (cls) result.classes.push({ line: lineNumber, name: cls[1] });

    if (/^(import|from)\b/.test(line)) result.imports.push(lineNumber);

    const assign = line.match(/^([A-Za-z_]\w*)\s*=\s*(?!=)/);
    if (assign && !/^(if|elif|while|for|def)\b/.test(line)) {
      result.variables.push({ line: lineNumber, name: assign[1] });
    }

    if (/^(for|while)\b/.test(line)) result.loops.push(lineNumber);
    if (/^(if|elif|else)\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^return\b/.test(line)) result.returns.push(lineNumber);
    if (/\bprint\s*\(/.test(line)) result.outputs.push(lineNumber);
  });

  return result;
}

// ------------------------------------------------------------
// Line-by-line explanation (symbol-table aware)
// ------------------------------------------------------------

export function explainLine(rawLine, symbolTable) {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  if (/^(import|from)\b/.test(trimmed)) {
    return "Imports a library or module so functionality from another part of the project (or Python's standard library) can be used.";
  }

  const fn = trimmed.match(/^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
  if (fn) {
    const params = fn[2].trim();
    return params
      ? `Defines the function \`${fn[1]}\`, which accepts \`${params}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  const cls = trimmed.match(/^class\s+([A-Za-z_]\w*)/);
  if (cls) return `Defines the class \`${cls[1]}\`, which can serve as a blueprint for creating objects.`;

  const forLoop = trimmed.match(/^for\s+(.+?)\s+in\s+(.+?)\s*:/);
  if (forLoop) {
    const targets = forLoop[1].split(",").map((t) => t.trim());
    const sourceExpr = forLoop[2].trim();
    const sourceName = sourceExpr.split(/[.(]/)[0].trim();
    const sourceInfo = symbolTable.get(sourceName);

    if (/^range\s*\(/.test(sourceExpr)) {
      return `Loops through a sequence of numbers produced by \`${sourceExpr}\`, with \`${targets.join(", ")}\` holding the current number on each pass.`;
    }

    const collectionPhrase = sourceInfo && sourceInfo.role === "list"
      ? `the \`${sourceName}\` list`
      : sourceInfo && sourceInfo.role === "dict"
      ? `the \`${sourceName}\` dictionary`
      : `\`${sourceName}\``;

    return `Iterates over ${collectionPhrase}; on each pass, \`${targets.join(", ")}\` represents the current item.`;
  }

  if (/^while\s+True\s*:/.test(trimmed)) {
    return "Starts an intentionally infinite loop, which must be exited with a `break` or `return` elsewhere.";
  }
  if (/^while\s+.+:/.test(trimmed)) {
    return "Starts a while loop that keeps running as long as its condition stays true.";
  }

  const ifMatch = trimmed.match(/^if\s+(.+):$/) || trimmed.match(/^elif\s+(.+):$/);
  if (ifMatch) {
    const condition = ifMatch[1].trim();
    const known = symbolTable.knownIdentifiersIn(condition);
    const prefix = /^elif\b/.test(trimmed) ? "Checks another condition" : "Checks whether";
    if (known.length === 1 && condition === known[0]) {
      return `${prefix === "Checks another condition" ? prefix : "Checks whether"} ${symbolTable.describe(known[0])} is truthy before running the code that follows.`;
    }
    return `${prefix} \`${condition}\` ${prefix === "Checks another condition" ? "is met" : "is true"} before running the code that follows.`;
  }

  if (/^else\s*:/.test(trimmed)) {
    return "Defines the alternative block that runs when none of the earlier conditions were true.";
  }

  const ret = trimmed.match(/^return\b\s*(.*)$/);
  if (ret) {
    const value = ret[1].trim();
    if (!value) return "Returns control from the current function without a value.";
    const known = symbolTable.knownIdentifiersIn(value);
    if (known.length === 1 && value === known[0]) {
      return `Returns ${symbolTable.describe(known[0])} from the current function.`;
    }
    return `Returns \`${value}\` from the current function.`;
  }

  const printMatch = trimmed.match(/^print\s*\((.*)\)$/);
  if (printMatch) {
    const arg = printMatch[1].trim();
    const known = symbolTable.knownIdentifiersIn(arg);
    if (known.length === 1 && arg === known[0]) {
      return `Displays ${symbolTable.describe(known[0])} as program output.`;
    }
    return arg
      ? `Displays \`${arg}\` as program output.`
      : "Prints a blank line as program output.";
  }

  const assign = trimmed.match(/^([A-Za-z_]\w*)\s*=\s*(?!=)(.+)$/);
  if (assign && !/^(if|elif|while|for|return|def|class)\b/.test(trimmed)) {
    const name = assign[1];
    const value = assign[2].trim();
    const info = symbolTable.get(name);

    if (info && info.role === "list") return `Creates the list \`${name}\` containing \`${value}\`.`;
    if (info && info.role === "dict") return `Creates the dictionary \`${name}\` with the key/value pairs \`${value}\`.`;
    if (info && info.role === "set") return `Creates the set \`${name}\` containing \`${value}\`.`;
    return `Assigns \`${value}\` to the variable \`${name}\`.`;
  }

  const funcCall = trimmed.match(/^([A-Za-z_]\w*)\s*\((.*)\)\s*$/);
  if (funcCall) {
    const info = symbolTable.get(funcCall[1]);
    const label = info && info.role === "function" ? `the \`${funcCall[1]}()\` function defined above` : `\`${funcCall[1]}()\``;
    return funcCall[2].trim()
      ? `Calls ${label} with the provided argument(s).`
      : `Calls ${label} without arguments.`;
  }

  // obj.method(args) — e.g. list.append(x), dict.update(x)
  const methodCall = trimmed.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\((.*)\)\s*$/);
  if (methodCall) {
    const [, objName, methodName, args] = methodCall;
    const objInfo = symbolTable.get(objName);
    const objPhrase = objInfo ? symbolTable.describe(objName) : `\`${objName}\``;
    return args.trim()
      ? `Calls \`.${methodName}(${args.trim()})\` on ${objPhrase}.`
      : `Calls \`.${methodName}()\` on ${objPhrase}.`;
  }

  return genericFallbackExplanation();
}

// ------------------------------------------------------------
// Python-specific issues
// ------------------------------------------------------------

export function findIssues(lines, symbolTable) {
  const issues = findCommonIssues(lines);

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;

    if (/^except\s*:\s*$/.test(line)) {
      issues.push({
        line: lineNumber, type: "warning",
        message: "This catches every exception without specifying a type. A more specific `except SomeError:` is usually safer.",
      });
    }

    if (/==\s*None\b/.test(line) || /\bNone\s*==/.test(line)) {
      issues.push({
        line: lineNumber, type: "review",
        message: "Comparing to `None` with `==` works, but `is None` is the more idiomatic and reliable Python style.",
      });
    }

    const mutableDefault = line.match(/^def\s+\w+\s*\([^)]*=\s*(\[\]|\{\})[^)]*\)/);
    if (mutableDefault) {
      issues.push({
        line: lineNumber, type: "warning",
        message: "Using a mutable default argument (`[]` or `{}`) can cause values to unexpectedly persist between function calls.",
      });
    }

    const emptyFn = /^def\s+\w+\s*\([^)]*\)\s*:\s*$/.test(line);
    if (emptyFn) {
      const currentIndent = rawLine.match(/^\s*/)[0].length;
      const next = lines.slice(index + 1).find((l) => l.trim());
      const nextIndent = next ? next.match(/^\s*/)[0].length : 0;
      if (!next || nextIndent <= currentIndent) {
        issues.push({ line: lineNumber, type: "warning", message: "This function appears to have no implementation yet." });
      }
    }
  });

  symbolTable.symbols.forEach((info, name) => {
    if (info.role === "parameter" || info.role === "loop-item") return;
    if (countUsages(lines, name) <= 1) {
      const defLine = lines.findIndex((l) => new RegExp(`\\b${name}\\b`).test(l));
      issues.push({ line: defLine + 1, type: "review", message: `Variable \`${name}\` appears to be assigned but may not be used later.` });
    }
  });

  return issues;
}
