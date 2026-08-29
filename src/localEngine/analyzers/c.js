import { isCommentLine, commentExplanation, findCommonIssues, genericFallbackExplanation, explainAugmentedAssignment, explainIncrementDecrement } from "../shared/patterns.js";

export const id = "c";
export const label = "C";

// Function-level scoping (see shared/patterns.js computeLineScopes):
// C function bodies are brace-delimited.
export const scopeStyle = "brace";
export const functionStartRegex = /^(?:static\s+)?[\w]+\s*\*?\s*([A-Za-z_]\w*)\s*\(/;

export function detect(code) {
  return /#include\s*<.*\.h>/.test(code) || /\bprintf\s*\(/.test(code) || /#include\s*<stdio\.h>/.test(code);
}

export function buildSymbolTable(lines, symbolTable, lineScopes = []) {
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || isCommentLine(line)) return;

    const scope = lineScopes[index] || "global";

    const fn = line.match(/^(?:static\s+)?[\w]+\s*\*?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{?$/);
    if (fn && !/\b(if|for|while|switch|return)\b/.test(line)) {
      symbolTable.add(fn[1], "function", { parameters: fn[2].trim() }, scope);
      const fnScope = `${scope}>${fn[1]}#${index}`;
      fn[2].split(",").map((p) => p.trim().split(/[\s*]+/).pop()).filter(Boolean).forEach((p) => symbolTable.add(p, "parameter", {}, fnScope));
    }

    const pointer = line.match(/^\w+\s*\*\s*([A-Za-z_]\w*)\s*=/);
    if (pointer) symbolTable.add(pointer[1], "pointer", {}, scope);

    const decl = line.match(/^(int|char|float|double|long|short)\s+([A-Za-z_]\w*)\s*=\s*(.+);/);
    if (decl) {
      const role = decl[1] === "char" ? "string" : "number";
      symbolTable.add(decl[2], role, {}, scope);
    }

    const arrayDecl = line.match(/^\w+\s+([A-Za-z_]\w*)\s*\[\s*\d*\s*\]/);
    if (arrayDecl) symbolTable.add(arrayDecl[1], "list", {}, scope);
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
    if (/^#include\b/.test(line)) result.imports.push(lineNumber);

    const fn = line.match(/^(?:static\s+)?[\w]+\s*\*?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{?$/);
    if (fn && !/\b(if|for|while|switch|return)\b/.test(line)) result.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });

    const decl = line.match(/^(?:int|char|float|double|long|short)\s+([A-Za-z_]\w*)/);
    if (decl) result.variables.push({ line: lineNumber, name: decl[1] });

    if (/^(for|while)\s*\(/.test(line)) result.loops.push(lineNumber);
    if (/^if\s*\(/.test(line) || /^else\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^return\b/.test(line)) result.returns.push(lineNumber);
    if (/\bprintf\s*\(/.test(line)) result.outputs.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine, symbolTable, scope = "global") {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  if (/^#include\s*<(.+)>/.test(trimmed)) {
    const m = trimmed.match(/^#include\s*<(.+)>/);
    return `Includes the \`${m[1]}\` header, giving access to its functions/macros.`;
  }

  const fn = trimmed.match(/^(?:static\s+)?[\w]+\s*\*?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{?$/);
  if (fn && !/\b(if|for|while|switch|return)\b/.test(trimmed)) {
    return fn[2].trim()
      ? `Defines the function \`${fn[1]}\`, which accepts \`${fn[2].trim()}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  if (/^for\s*\(/.test(trimmed)) return "Starts a counted loop that repeats a block of code a set number of times.";
  if (/^while\s*\(/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";

  const ifMatch = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
  if (ifMatch) {
    const known = symbolTable.knownIdentifiersIn(ifMatch[1], scope);
    if (known.length === 1 && ifMatch[1].trim() === known[0]) return `Checks whether ${symbolTable.describe(known[0], scope)} is non-zero before running the code that follows.`;
    return `Checks whether \`${ifMatch[1].trim()}\` is true before running the code that follows.`;
  }
  if (/^else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";

  const ret = trimmed.match(/^return\b\s*(.*?);?$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current function.` : "Returns control from the current function.";

  const printf = trimmed.match(/\bprintf\s*\((.*)\)\s*;?$/);
  if (printf) return `Formats and prints \`${printf[1].trim()}\` to standard output.`;

  const pointer = trimmed.match(/^\w+\s*\*\s*([A-Za-z_]\w*)\s*=\s*(.+);/);
  if (pointer) return `Declares the pointer \`${pointer[1]}\` and points it at \`${pointer[2]}\`.`;

  const decl = trimmed.match(/^(int|char|float|double|long|short)\s+([A-Za-z_]\w*)\s*=\s*(.+);/);
  if (decl) return `Declares a \`${decl[1]}\` variable \`${decl[2]}\` and assigns it \`${decl[3]}\`.`;

  if (["}", "};"].includes(trimmed)) return "Closes the current code block.";

  const incDec = explainIncrementDecrement(trimmed);
  if (incDec) return incDec;

  const augmented = explainAugmentedAssignment(trimmed, symbolTable, scope);
  if (augmented) return augmented;

  return genericFallbackExplanation();
}

export function findIssues(lines, symbolTable) {
  const issues = findCommonIssues(lines);
  const mallocLines = [];
  let hasFree = false;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/\bmalloc\s*\(/.test(line) || /\bcalloc\s*\(/.test(line)) mallocLines.push(index + 1);
    if (/\bfree\s*\(/.test(line)) hasFree = true;
    if (/\bgets\s*\(/.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "`gets()` cannot bound how much input it reads and is unsafe; use `fgets()` instead." });
    }
    if (/\bstrcpy\s*\(/.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "`strcpy()` does not check buffer size and can overflow; consider `strncpy()`." });
    }
  });

  if (mallocLines.length && !hasFree) {
    mallocLines.forEach((line) =>
      issues.push({ line, type: "warning", message: "Memory allocated here (`malloc`/`calloc`) doesn't appear to be released with a matching `free()` anywhere in this snippet." })
    );
  }

  return issues;
}
