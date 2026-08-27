import { isCommentLine, commentExplanation, findCommonIssues, genericFallbackExplanation } from "../shared/patterns.js";

export const id = "swift";
export const label = "Swift";

// Function-level scoping (see shared/patterns.js computeLineScopes):
// Swift function bodies are brace-delimited.
export const scopeStyle = "brace";
export const functionStartRegex = /^func\s+([A-Za-z_]\w*)\s*\(/;

export function detect(code) {
  return /\bimport\s+(Foundation|UIKit|SwiftUI)\b/.test(code) || (/\b(let|var)\s+\w+/.test(code) && /\bfunc\s+\w+/.test(code));
}

function literalRole(value) {
  const v = value.trim();
  if (/^\[.*:.*\]$/s.test(v)) return "dict";
  if (/^\[.*\]$/s.test(v)) return "list";
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

    const fn = line.match(/^func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) {
      symbolTable.add(fn[1], "function", { parameters: fn[2].trim() }, scope);
      const fnScope = `${scope}>${fn[1]}#${index}`;
      fn[2].split(",").map((p) => p.trim().split(/\s*:\s*/)[0].split(/\s+/).pop()).filter(Boolean).forEach((p) => symbolTable.add(p, "parameter", {}, fnScope));
    }

    const cls = line.match(/\b(?:class|struct)\s+([A-Za-z_]\w*)/);
    if (cls) symbolTable.add(cls[1], "class", {}, scope);

    const decl = line.match(/^(let|var)\s+([A-Za-z_]\w*)\s*(?::\s*[\w<>\[\]?]+)?\s*=\s*(.+)$/);
    if (decl) symbolTable.add(decl[2], literalRole(decl[3]), {}, scope);

    const forLoop = line.match(/^for\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)/);
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
    if (/^import\s+\w+/.test(line)) result.imports.push(lineNumber);

    const fn = line.match(/^func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) result.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });

    const cls = line.match(/\b(?:class|struct)\s+([A-Za-z_]\w*)/);
    if (cls) result.classes.push({ line: lineNumber, name: cls[1] });

    const decl = line.match(/^(?:let|var)\s+([A-Za-z_]\w*)/);
    if (decl) result.variables.push({ line: lineNumber, name: decl[1] });

    if (/^(for|while)\b/.test(line)) result.loops.push(lineNumber);
    if (/^if\b/.test(line) || /^else\b/.test(line) || /^switch\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^return\b/.test(line)) result.returns.push(lineNumber);
    if (/\bprint\s*\(/.test(line)) result.outputs.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine, symbolTable, scope = "global") {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  if (/^import\s+\w+/.test(trimmed)) return "Imports a framework so its types/functions can be used in this file.";

  const cls = trimmed.match(/\b(class|struct)\s+([A-Za-z_]\w*)/);
  if (cls) return `Defines the ${cls[1]} \`${cls[2]}\`, which can serve as a blueprint for creating objects.`;

  const fn = trimmed.match(/^func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
  if (fn) {
    return fn[2].trim()
      ? `Defines the function \`${fn[1]}\`, which accepts \`${fn[2].trim()}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  const forLoop = trimmed.match(/^for\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)/);
  if (forLoop) {
    const info = symbolTable.get(forLoop[2], scope);
    const phrase = info && info.role === "list" ? `the \`${forLoop[2]}\` array` : `\`${forLoop[2]}\``;
    return `Iterates over ${phrase}; on each pass, \`${forLoop[1]}\` represents the current item.`;
  }
  if (/^while\s+/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";

  const ifMatch = trimmed.match(/^if\s+(.+?)\s*\{?$/);
  if (ifMatch) {
    const condition = ifMatch[1].trim();
    const known = symbolTable.knownIdentifiersIn(condition, scope);
    if (known.length === 1 && condition === known[0]) return `Checks whether ${symbolTable.describe(known[0], scope)} meets the condition before running the code that follows.`;
    return `Checks whether \`${condition}\` is true before running the code that follows.`;
  }
  if (/^\}?\s*else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";
  if (/^switch\s+/.test(trimmed)) return "Starts a switch statement that picks a branch based on the value.";

  const ret = trimmed.match(/^return\b\s*(.*)$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current function.` : "Returns control from the current function.";

  const print = trimmed.match(/\bprint\s*\((.*)\)\s*$/);
  if (print) return `Prints \`${print[1].trim()}\` to the console.`;

  const decl = trimmed.match(/^(let|var)\s+([A-Za-z_]\w*)\s*(?::\s*[\w<>\[\]?]+)?\s*=\s*(.+)$/);
  if (decl) {
    const kind = decl[1] === "let" ? "constant" : "variable";
    return `Declares the ${kind} \`${decl[2]}\` and assigns it \`${decl[3]}\`.`;
  }

  if (["}"].includes(trimmed)) return "Closes the current code block.";

  return genericFallbackExplanation();
}

export function findIssues(lines) {
  const issues = findCommonIssues(lines);
  lines.forEach((rawLine, index) => {
    if (/\bas!\s+\w+/.test(rawLine)) {
      issues.push({ line: index + 1, type: "warning", message: "Force-cast `as!` will crash if the cast fails. A conditional `as?` is usually safer." });
    }
    if (/!\s*$/.test(rawLine.trim()) && /^(let|var)\b/.test(rawLine.trim())) {
      issues.push({ line: index + 1, type: "review", message: "Force-unwrapping an optional here will crash if the value is `nil`." });
    }
  });
  return issues;
}
