import { isCommentLine, commentExplanation, findCommonIssues, genericFallbackExplanation, explainAugmentedAssignment, explainIncrementDecrement, explainTernary, explainClassicForLoop } from "../shared/patterns.js";

export const id = "cpp";
export const label = "C++";

// Function-level scoping (see shared/patterns.js computeLineScopes):
// C++ function bodies are brace-delimited.
export const scopeStyle = "brace";
export const functionStartRegex = /^(?:static\s+)?[\w:<>]+\s*&?\s*([A-Za-z_]\w*)\s*\(/;

export function detect(code) {
  return /\b(std::|cout|cin|vector<|namespace)\b/.test(code) || /#include\s*<(iostream|vector|string|map)>/.test(code);
}

export function buildSymbolTable(lines, symbolTable, lineScopes = []) {
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || isCommentLine(line)) return;

    const scope = lineScopes[index] || "global";

    const cls = line.match(/\bclass\s+([A-Za-z_]\w*)/);
    if (cls) symbolTable.add(cls[1], "class", {}, scope);

    const fn = line.match(/^(?:static\s+)?[\w:<>]+\s*&?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{?$/);
    if (fn && !/\b(if|for|while|switch)\b/.test(line)) {
      symbolTable.add(fn[1], "function", { parameters: fn[2].trim() }, scope);
      const fnScope = `${scope}>${fn[1]}#${index}`;
      fn[2].split(",").map((p) => p.trim().split(/[\s&*]+/).pop()).filter(Boolean).forEach((p) => symbolTable.add(p, "parameter", {}, fnScope));
    }

    const vec = line.match(/(?:std::)?vector\s*<[^>]*>\s*&?\s*([A-Za-z_]\w*)\s*[=({]/);
    if (vec) symbolTable.add(vec[1], "list", {}, scope);

    const map = line.match(/(?:std::)?map\s*<[^>]*>\s*&?\s*([A-Za-z_]\w*)\s*[=({]/);
    if (map) symbolTable.add(map[1], "dict", {}, scope);

    const decl = line.match(/^(int|double|float|char|bool|string|std::string)\s+([A-Za-z_]\w*)\s*=\s*(.+);/);
    if (decl) {
      const roleMap = { int: "number", double: "number", float: "number", bool: "boolean", char: "string", string: "string", "std::string": "string" };
      symbolTable.add(decl[2], roleMap[decl[1]] || "variable", {}, scope);
    }

    // range-based for: for (auto& item : items) / for (Type item : items)
    const forRange = line.match(/^for\s*\(\s*(?:auto|[\w:<>]+)\s*&?\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)\s*\)/);
    if (forRange) {
      const info = symbolTable.get(forRange[2], scope);
      symbolTable.add(forRange[1], "loop-item", { of: forRange[2], ofType: info ? info.role : "collection" }, scope);
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
    if (/^#include\b/.test(line)) result.imports.push(lineNumber);

    const cls = line.match(/\bclass\s+([A-Za-z_]\w*)/);
    if (cls) result.classes.push({ line: lineNumber, name: cls[1] });

    const fn = line.match(/^(?:static\s+)?[\w:<>]+\s*&?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{?$/);
    if (fn && !/\b(if|for|while|switch)\b/.test(line)) result.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });

    if (/^(for|while)\s*\(/.test(line)) result.loops.push(lineNumber);
    if (/^if\s*\(/.test(line) || /^else\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^return\b/.test(line)) result.returns.push(lineNumber);
    if (/\bcout\s*<</.test(line)) result.outputs.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine, symbolTable, scope = "global") {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  const include = trimmed.match(/^#include\s*<(.+)>/);
  if (include) return `Includes the \`${include[1]}\` standard library header.`;

  const cls = trimmed.match(/\bclass\s+([A-Za-z_]\w*)/);
  if (cls) return `Defines the class \`${cls[1]}\`, which can serve as a blueprint for creating objects.`;

  const forRange = trimmed.match(/^for\s*\(\s*(?:auto|[\w:<>]+)\s*&?\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)\s*\)/);
  if (forRange) {
    const info = symbolTable.get(forRange[2], scope);
    const phrase = info && info.role === "list" ? `the \`${forRange[2]}\` vector` : `\`${forRange[2]}\``;
    return `Iterates over ${phrase}; on each pass, \`${forRange[1]}\` represents the current item.`;
  }

  if (/^for\s*\(/.test(trimmed)) return explainClassicForLoop(trimmed) || "Starts a counted loop that repeats a block of code a set number of times.";
  if (/^while\s*\(/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";

  const ifMatch = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
  if (ifMatch) {
    const known = symbolTable.knownIdentifiersIn(ifMatch[1], scope);
    if (known.length === 1 && ifMatch[1].trim() === known[0]) return `Checks whether ${symbolTable.describe(known[0], scope)} is true before running the code that follows.`;
    return `Checks whether \`${ifMatch[1].trim()}\` is true before running the code that follows.`;
  }
  if (/^else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";

  const ret = trimmed.match(/^return\b\s*(.*?);?$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current function.` : "Returns control from the current function.";

  const cout = trimmed.match(/\bcout\s*<<\s*(.+?)\s*(?:<<\s*endl)?\s*;?$/);
  if (cout) return `Sends \`${cout[1].trim()}\` to standard output.`;

  const vec = trimmed.match(/(?:std::)?vector\s*<[^>]*>\s*&?\s*([A-Za-z_]\w*)\s*=\s*(.+);/);
  if (vec) return `Creates the vector \`${vec[1]}\` and initializes it with \`${vec[2]}\`.`;

  const decl = trimmed.match(/^(int|double|float|char|bool|string|std::string)\s+([A-Za-z_]\w*)\s*=\s*(.+);/);
  if (decl) {
    const ternary = explainTernary(decl[2], decl[3]);
    if (ternary) return ternary;
    return `Declares a \`${decl[1]}\` variable \`${decl[2]}\` and assigns it \`${decl[3]}\`.`;
  }

  if (["}", "};"].includes(trimmed)) return "Closes the current code block.";

  const incDec = explainIncrementDecrement(trimmed);
  if (incDec) return incDec;

  const augmented = explainAugmentedAssignment(trimmed, symbolTable, scope);
  if (augmented) return augmented;

  return genericFallbackExplanation();
}

export function findIssues(lines) {
  const issues = findCommonIssues(lines);
  let hasNew = 0;
  let hasDelete = 0;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/\bnew\s+\w+/.test(line)) hasNew++;
    if (/\bdelete\b/.test(line)) hasDelete++;
    if (/\busing\s+namespace\s+std\s*;/.test(line)) {
      issues.push({ line: index + 1, type: "review", message: "`using namespace std;` at file/global scope can cause naming conflicts in larger projects." });
    }
    if (/\bsprintf\s*\(/.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "`sprintf()` writes without checking buffer size and can overflow; use `snprintf()` with an explicit size instead." });
    }
    const cppSystemCall = line.match(/\bsystem\s*\((.+)\)\s*;?$/);
    if (cppSystemCall && !/^".*"$/.test(cppSystemCall[1].trim())) {
      issues.push({ line: index + 1, type: "security", message: "`system()` is called with a non-literal argument. If any part comes from user input, this is a command-injection risk." });
    }
  });

  if (hasNew > hasDelete) {
    issues.push({ line: 1, type: "warning", message: "There are more `new` allocations than `delete` calls in this snippet — check for a possible memory leak (or consider smart pointers)." });
  }

  return issues;
}
