import { isCommentLine, commentExplanation, findCommonIssues, genericFallbackExplanation, explainAugmentedAssignment, explainIncrementDecrement } from "../shared/patterns.js";

export const id = "kotlin";
export const label = "Kotlin";

// Function-level scoping (see shared/patterns.js computeLineScopes):
// Kotlin function bodies are brace-delimited.
export const scopeStyle = "brace";
export const functionStartRegex = /^fun\s+([A-Za-z_]\w*)\s*\(/;

export function detect(code) {
  return /\bfun\s+main\s*\(/.test(code) || (/\b(val|var)\s+\w+/.test(code) && /\bfun\s+\w+/.test(code)) || /\bprintln\s*\(/.test(code);
}

function literalRole(value) {
  const v = value.trim();
  if (/^listOf\s*\(|^mutableListOf\s*\(|^\[.*\]$/.test(v)) return "list";
  if (/^mapOf\s*\(|^mutableMapOf\s*\(/.test(v)) return "dict";
  if (/^".*"$/.test(v)) return "string";
  if (/^(true|false)$/.test(v)) return "boolean";
  if (/^-?\d+(\.\d+)?$/.test(v)) return "number";
  return "variable";
}

export function buildSymbolTable(lines, symbolTable, lineScopes = []) {
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || isCommentLine(line)) return;

    const scope = lineScopes[index] || "global";

    const fn = line.match(/^fun\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) {
      symbolTable.add(fn[1], "function", { parameters: fn[2].trim() }, scope);
      const fnScope = `${scope}>${fn[1]}#${index}`;
      fn[2].split(",").map((p) => p.trim().split(/\s*:\s*/)[0].trim()).filter(Boolean).forEach((p) => symbolTable.add(p, "parameter", {}, fnScope));
    }

    const cls = line.match(/\b(?:class|data class)\s+([A-Za-z_]\w*)/);
    if (cls) symbolTable.add(cls[1], "class", {}, scope);

    const decl = line.match(/^(val|var)\s+([A-Za-z_]\w*)\s*(?::\s*[\w<>?]+)?\s*=\s*(.+)$/);
    if (decl) symbolTable.add(decl[2], literalRole(decl[3]), {}, scope);

    const forLoop = line.match(/^for\s*\(\s*([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)\s*\)/);
    if (forLoop) {
      const info = symbolTable.get(forLoop[2], scope);
      symbolTable.add(forLoop[1], "loop-item", { of: forLoop[2], ofType: info ? info.role : "collection" }, scope);
    }
  });

  return symbolTable;
}

export function analyzeStructure(lines) {
  const result = { functions: [], classes: [], imports: [], variables: [], loops: [], conditionals: [], returns: [], outputs: [], comments: [] };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;
    if (isCommentLine(line)) result.comments.push(lineNumber);
    if (/^import\s+[\w.]+/.test(line)) result.imports.push(lineNumber);

    const fn = line.match(/^fun\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) result.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });

    const cls = line.match(/\b(?:class|data class)\s+([A-Za-z_]\w*)/);
    if (cls) result.classes.push({ line: lineNumber, name: cls[1] });

    const decl = line.match(/^(?:val|var)\s+([A-Za-z_]\w*)/);
    if (decl) result.variables.push({ line: lineNumber, name: decl[1] });

    if (/^for\s*\(/.test(line) || /^while\s*\(/.test(line)) result.loops.push(lineNumber);
    if (/^if\s*\(/.test(line) || /^else\b/.test(line) || /^when\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^return\b/.test(line)) result.returns.push(lineNumber);
    if (/\bprintln\s*\(/.test(line)) result.outputs.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine, symbolTable, scope = "global") {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  if (/^import\s+[\w.]+/.test(trimmed)) return "Imports a class or package so it can be used in this file.";

  const cls = trimmed.match(/\b(class|data class)\s+([A-Za-z_]\w*)/);
  if (cls) return `Defines the ${cls[1]} \`${cls[2]}\`, which can serve as a blueprint for creating objects.`;

  const fn = trimmed.match(/^fun\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
  if (fn) {
    return fn[2].trim()
      ? `Defines the function \`${fn[1]}\`, which accepts \`${fn[2].trim()}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  const forLoop = trimmed.match(/^for\s*\(\s*([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)\s*\)/);
  if (forLoop) {
    const info = symbolTable.get(forLoop[2], scope);
    const phrase = info && info.role === "list" ? `the \`${forLoop[2]}\` list` : `\`${forLoop[2]}\``;
    return `Iterates over ${phrase}; on each pass, \`${forLoop[1]}\` represents the current item.`;
  }
  if (/^while\s*\(/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";

  const ifMatch = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
  if (ifMatch) {
    const condition = ifMatch[1].trim();
    const known = symbolTable.knownIdentifiersIn(condition, scope);
    if (known.length === 1 && condition === known[0]) return `Checks whether ${symbolTable.describe(known[0], scope)} meets the condition before running the code that follows.`;
    return `Checks whether \`${condition}\` is true before running the code that follows.`;
  }
  if (/^\}?\s*else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";
  if (/^when\s*\(/.test(trimmed)) return "Starts a when expression that picks a branch based on the value.";

  const ret = trimmed.match(/^return\b\s*(.*)$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current function.` : "Returns control from the current function.";

  const print = trimmed.match(/\bprintln\s*\((.*)\)\s*$/);
  if (print) return `Prints \`${print[1].trim()}\` to the console, followed by a newline.`;

  const decl = trimmed.match(/^(val|var)\s+([A-Za-z_]\w*)\s*(?::\s*[\w<>?]+)?\s*=\s*(.+)$/);
  if (decl) {
    const kind = decl[1] === "val" ? "read-only" : "mutable";
    // Kotlin has no C-style `cond ? a : b` — that syntax is reserved for
    // the Elvis/null-coalescing operator (`a ?: b`). Conditional values
    // are written with `if` as an expression instead.
    const ifExpr = decl[3].trim().match(/^if\s*\((.+)\)\s*(.+?)\s+else\s+(.+)$/s);
    if (ifExpr) {
      const [, condition, whenTrue, whenFalse] = ifExpr;
      return `Declares the ${kind} property \`${decl[2]}\` and sets it to \`${whenTrue.trim()}\` if \`${condition.trim()}\` is true, otherwise \`${whenFalse.trim()}\` (Kotlin's \`if\` used as an expression).`;
    }
    return `Declares the ${kind} property \`${decl[2]}\` and assigns it \`${decl[3]}\`.`;
  }

  if (["}"].includes(trimmed)) return "Closes the current code block.";

  const incDec = explainIncrementDecrement(trimmed);
  if (incDec) return incDec;

  const augmented = explainAugmentedAssignment(trimmed, symbolTable, scope);
  if (augmented) return augmented;

  return genericFallbackExplanation();
}

export function findIssues(lines) {
  const issues = findCommonIssues(lines);
  lines.forEach((rawLine, index) => {
    // Catches `x!!` anywhere on the line — inside a function call
    // (`println(x!!)`), a property access (`x!!.foo`), or standalone.
    if (/[A-Za-z_]\w*!!/.test(rawLine)) {
      issues.push({ line: index + 1, type: "warning", message: "The `!!` non-null assertion throws if the value is actually `null`. A safe call `?.` is usually safer." });
    }
    const line = rawLine.trim();
    if ((/\bRuntime\.getRuntime\s*\(\s*\)\s*\.exec\s*\(/.test(line) || /\bProcessBuilder\s*\(/.test(line)) && /\+/.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "A process is launched with a concatenated command string. If any part comes from user input, this is a command-injection risk — pass arguments as a list instead." });
    }
  });
  return issues;
}
