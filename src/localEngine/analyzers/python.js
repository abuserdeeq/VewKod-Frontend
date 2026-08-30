import { isCommentLine, commentExplanation, findCommonIssues, countUsages, genericFallbackExplanation, explainAugmentedAssignment, explainMultipleAssignment, explainComprehension, mdCode } from "../shared/patterns.js";

export const id = "python";
export const label = "Python";

// Function-level scoping (see shared/patterns.js computeLineScopes):
// Python blocks are indentation-delimited.
export const scopeStyle = "indent";
export const functionStartRegex = /^def\s+([A-Za-z_]\w*)/;

export function detect(code) {
  // Require Python's distinctive `def name(...):` header (colon after
  // the parameter list) rather than a bare `def`/`print` keyword —
  // `print(x)` also appears in Swift.
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

export function buildSymbolTable(lines, symbolTable, lineScopes = []) {
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || isCommentLine(line)) return;

    const scope = lineScopes[index] || "global";

    // def name(params):
    const fn = line.match(/^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) {
      // The function's own name is visible in the *enclosing* scope;
      // its parameters only exist inside the function's own scope.
      symbolTable.add(fn[1], "function", { parameters: fn[2].trim() }, scope);
      const fnScope = `${scope}>${fn[1]}#${index}`;
      fn[2].split(",").map((p) => p.trim().split("=")[0].trim()).filter(Boolean).forEach((p) => {
        if (p !== "self") symbolTable.add(p, "parameter", {}, fnScope);
      });
    }

    // class Name
    const cls = line.match(/^class\s+([A-Za-z_]\w*)/);
    if (cls) symbolTable.add(cls[1], "class", {}, scope);

    // for X in Y:   /   for X, Y in Z.items():
    const forLoop = line.match(/^for\s+(.+?)\s+in\s+(.+?)\s*:/);
    if (forLoop) {
      const targets = forLoop[1].split(",").map((t) => t.trim());
      const sourceExpr = forLoop[2].trim();
      const sourceName = sourceExpr.split(/[.(]/)[0].trim();
      const sourceInfo = symbolTable.get(sourceName, scope);

      if (/^range\s*\(/.test(sourceExpr)) {
        targets.forEach((t) => symbolTable.add(t, "loop-item", { of: "range(...)", ofType: "number sequence" }, scope));
      } else {
        const ofType = sourceInfo ? sourceInfo.role : "collection";
        targets.forEach((t) =>
          symbolTable.add(t, "loop-item", { of: sourceName, ofType }, scope)
        );
      }
    }

    // multiple/parallel assignment: a, b = b, a  /  a, b = 1, 2
    const multiAssign = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*=\s*(?!=)(.+)$/);
    if (multiAssign) {
      multiAssign[1].split(",").map((t) => t.trim()).forEach((t) => symbolTable.add(t, "variable", {}, scope));
    }

    // plain assignment: name = value  (skip comparisons / keywords)
    const assign = line.match(/^([A-Za-z_]\w*)\s*=\s*(?!=)(.+)$/);
    if (assign && !/^(if|elif|while|for|return|def|class)\b/.test(line)) {
      const name = assign[1];
      const role = literalRole(assign[2]);
      symbolTable.add(name, role, {}, scope);
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

    const multiAssign = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*=\s*(?!=)/);
    if (multiAssign) {
      multiAssign[1].split(",").map((t) => t.trim()).forEach((name) => result.variables.push({ line: lineNumber, name }));
    }

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

export function explainLine(rawLine, symbolTable, scope = "global") {
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
    const sourceInfo = symbolTable.get(sourceName, scope);

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
    const known = symbolTable.knownIdentifiersIn(condition, scope);
    const prefix = /^elif\b/.test(trimmed) ? "Checks another condition" : "Checks whether";
    if (known.length === 1 && condition === known[0]) {
      return `${prefix === "Checks another condition" ? prefix : "Checks whether"} ${symbolTable.describe(known[0], scope)} is truthy before running the code that follows.`;
    }
    return `${prefix} ${mdCode(condition)} ${prefix === "Checks another condition" ? "is met" : "is true"} before running the code that follows.`;
  }

  if (/^else\s*:/.test(trimmed)) {
    return "Defines the alternative block that runs when none of the earlier conditions were true.";
  }

  if (/^try\s*:$/.test(trimmed)) {
    return "Starts a `try` block; if an error occurs anywhere inside it, control jumps to the matching `except` block below.";
  }

  const exceptMatch = trimmed.match(/^except(?:\s+([\w.]+))?(?:\s+as\s+(\w+))?\s*:$/);
  if (exceptMatch) {
    const [, excType, excName] = exceptMatch;
    if (!excType) return "Catches any exception raised in the `try` block above.";
    return excName
      ? `Catches a \`${excType}\` exception raised in the \`try\` block above, made available here as \`${excName}\`.`
      : `Catches a \`${excType}\` exception raised in the \`try\` block above.`;
  }

  if (/^finally\s*:$/.test(trimmed)) {
    return "Starts a `finally` block, which always runs after the `try`/`except`, whether or not an exception occurred.";
  }

  const raiseMatch = trimmed.match(/^raise\b\s*(.*)$/);
  if (raiseMatch) {
    const value = raiseMatch[1].trim();
    return value
      ? `Raises an exception (${mdCode(value)}), stopping normal execution so it can be caught by an enclosing \`try\`/\`except\`.`
      : "Re-raises the exception currently being handled.";
  }

  const ret = trimmed.match(/^return\b\s*(.*)$/);
  if (ret) {
    const value = ret[1].trim();
    if (!value) return "Returns control from the current function without a value.";
    const known = symbolTable.knownIdentifiersIn(value, scope);
    if (known.length === 1 && value === known[0]) {
      return `Returns ${symbolTable.describe(known[0], scope)} from the current function.`;
    }
    return `Returns ${mdCode(value)} from the current function.`;
  }

  const printMatch = trimmed.match(/^print\s*\((.*)\)$/);
  if (printMatch) {
    const arg = printMatch[1].trim();

    const fstring = arg.match(/^f(["'])([\s\S]*)\1$/);
    if (fstring) {
      const body = fstring[2];
      const placeholders = [...body.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1].trim());
      if (placeholders.length === 0) {
        return `Displays the text ${mdCode(body)} as program output.`;
      }
      const described = placeholders.map((p) => {
        const knownInner = symbolTable.knownIdentifiersIn(p, scope);
        return knownInner.length === 1 && p === knownInner[0]
          ? symbolTable.describe(knownInner[0], scope)
          : mdCode(p);
      });
      const list = described.length === 1
        ? described[0]
        : `${described.slice(0, -1).join(", ")} and ${described[described.length - 1]}`;
      return `Displays a formatted message, embedding ${list} into the text.`;
    }

    const known = symbolTable.knownIdentifiersIn(arg, scope);
    if (known.length === 1 && arg === known[0]) {
      return `Displays ${symbolTable.describe(known[0], scope)} as program output.`;
    }
    return arg
      ? `Displays ${mdCode(arg)} as program output.`
      : "Prints a blank line as program output.";
  }

  const multiAssign = explainMultipleAssignment(trimmed);
  if (multiAssign) return multiAssign;

  const augmented = explainAugmentedAssignment(trimmed, symbolTable, scope);
  if (augmented) return augmented;

  const assign = trimmed.match(/^([A-Za-z_]\w*)\s*=\s*(?!=)(.+)$/);
  if (assign && !/^(if|elif|while|for|return|def|class)\b/.test(trimmed)) {
    const name = assign[1];
    const value = assign[2].trim();
    const info = symbolTable.get(name, scope);

    const comprehension = explainComprehension(name, value);
    if (comprehension) return comprehension;

    const ternary = value.match(/^(.+?)\s+if\s+(.+?)\s+else\s+(.+)$/s);
    if (ternary) {
      const [, whenTrue, condition, whenFalse] = ternary;
      return `Assigns \`${name}\` to ${mdCode(whenTrue.trim())} if ${mdCode(condition.trim())} is true, otherwise ${mdCode(whenFalse.trim())} — a conditional (ternary) expression.`;
    }

    if (info && info.role === "list") return `Creates the list \`${name}\` containing ${mdCode(value)}.`;
    if (info && info.role === "dict") return `Creates the dictionary \`${name}\` with the key/value pairs ${mdCode(value)}.`;
    if (info && info.role === "set") return `Creates the set \`${name}\` containing ${mdCode(value)}.`;
    return `Assigns ${mdCode(value)} to the variable \`${name}\`.`;
  }

  const funcCall = trimmed.match(/^([A-Za-z_]\w*)\s*\((.*)\)\s*$/);
  if (funcCall) {
    const info = symbolTable.get(funcCall[1], scope);
    const label = info && info.role === "function" ? `the \`${funcCall[1]}()\` function defined above` : `\`${funcCall[1]}()\``;
    return funcCall[2].trim()
      ? `Calls ${label} with the provided argument(s).`
      : `Calls ${label} without arguments.`;
  }

  // obj.method(args) — e.g. list.append(x), dict.update(x)
  const methodCall = trimmed.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\((.*)\)\s*$/);
  if (methodCall) {
    const [, objName, methodName, args] = methodCall;
    const objInfo = symbolTable.get(objName, scope);
    const objPhrase = objInfo ? symbolTable.describe(objName, scope) : `\`${objName}\``;
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

    // os.system()/os.popen() with a non-literal argument, or
    // subprocess.* called with shell=True and a non-literal command —
    // both hand a string straight to the shell, which is a classic
    // command-injection sink if any part of it comes from user input.
    const osSystemCall = line.match(/\bos\.(system|popen)\s*\((.+)\)\s*$/);
    if (osSystemCall && !/^["'].*["']$/.test(osSystemCall[2].trim())) {
      issues.push({
        line: lineNumber, type: "security",
        message: `\`os.${osSystemCall[1]}()\` runs its argument through the shell. If any part of it comes from user input, this is a command-injection risk — prefer \`subprocess.run([...])\` with a list of arguments and no \`shell=True\`.`,
      });
    }
    if (/\bsubprocess\.(run|call|Popen|check_call|check_output)\s*\(/.test(line) && /shell\s*=\s*True/.test(line) && !/subprocess\.\w+\s*\(\s*["']/.test(line)) {
      issues.push({
        line: lineNumber, type: "security",
        message: "`subprocess` called with `shell=True` and a non-literal command runs it through the shell — a command-injection risk if user input reaches it. Prefer passing a list of arguments with `shell=False` (the default).",
      });
    }

    // Unsafe deserialization: pickle.load(s) trusts arbitrary bytes to
    // reconstruct arbitrary objects, and yaml.load() without a safe
    // Loader can do the same — both can lead to code execution.
    if (/\bpickle\.loads?\s*\(/.test(line)) {
      issues.push({
        line: lineNumber, type: "security",
        message: "`pickle.load()`/`loads()` can execute arbitrary code while deserializing. Never unpickle data from an untrusted source.",
      });
    }
    if (/\byaml\.load\s*\(/.test(line) && !/Loader\s*=\s*(yaml\.)?SafeLoader/.test(line)) {
      issues.push({
        line: lineNumber, type: "security",
        message: "`yaml.load()` without `Loader=yaml.SafeLoader` can construct arbitrary Python objects from the input. Use `yaml.safe_load()` instead.",
      });
    }

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

  symbolTable.symbols.forEach((info) => {
    // Functions/classes are commonly defined without being called within
    // the same standalone snippet — flagging that as "unused" produces a
    // false positive on almost every single-function snippet, so only
    // variables are checked here.
    if (["parameter", "loop-item", "function", "class"].includes(info.role)) return;
    const name = info.name;
    if (countUsages(lines, name) <= 1) {
      const defLine = lines.findIndex((l) => new RegExp(`\\b${name}\\b`).test(l));
      issues.push({ line: defLine + 1, type: "review", message: `Variable \`${name}\` appears to be assigned but may not be used later.` });
    }
  });

  return issues;
}
