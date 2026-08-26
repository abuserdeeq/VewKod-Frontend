import { findCommonIssues, genericFallbackExplanation } from "../shared/patterns.js";

export const id = "bash";
export const label = "Bash";

export function detect(code) {
  // Shebang is the strongest signal. Otherwise require shell-specific
  // block terminators (`fi`/`done`) rather than just `echo` + `$var`,
  // since those two alone also appear in PHP snippets without `<?php`.
  return /^#!.*\b(bash|sh)\b/.test(code.trim()) || (/\bfi\b/.test(code) && /\bdone\b/.test(code));
}

function isCommentLine(trimmed) {
  return trimmed.startsWith("#") && !trimmed.startsWith("#!");
}

function literalRole(value) {
  const v = value.trim();
  if (/^\(.*\)$/.test(v)) return "list";
  if (/^["'].*["']$/.test(v)) return "string";
  if (/^-?\d+$/.test(v)) return "number";
  return "variable";
}

export function buildSymbolTable(lines, symbolTable) {
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || isCommentLine(line)) return;

    const fn = line.match(/^(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{?$/);
    if (fn) symbolTable.add(fn[1], "function");

    const decl = line.match(/^([A-Za-z_]\w*)=(.+)$/);
    if (decl) symbolTable.add(decl[1], literalRole(decl[2]));

    // for item in list; do
    const forLoop = line.match(/^for\s+([A-Za-z_]\w*)\s+in\s+([^;]+);?\s*do?$/);
    if (forLoop) {
      const sourceExpr = forLoop[2].trim();
      const sourceName = sourceExpr.replace(/[${}]/g, "").split(/\s|\[/)[0];
      const info = symbolTable.get(sourceName);
      symbolTable.add(forLoop[1], "loop-item", { of: sourceName, ofType: info ? info.role : "list" });
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
    if (/^source\b/.test(line) || /^\.\s+\S/.test(line)) result.imports.push(lineNumber);

    const fn = line.match(/^(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{?$/);
    if (fn) result.functions.push({ line: lineNumber, name: fn[1], parameters: "" });

    const decl = line.match(/^([A-Za-z_]\w*)=/);
    if (decl) result.variables.push({ line: lineNumber, name: decl[1] });

    if (/^(for|while)\b/.test(line)) result.loops.push(lineNumber);
    if (/^if\b/.test(line) || /^elif\b/.test(line) || /^else\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^echo\b/.test(line)) result.outputs.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine, symbolTable) {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#!")) return "The shebang line — tells the OS which interpreter should run this script.";
  if (isCommentLine(trimmed)) return "This is a comment. It provides information for developers and is not executed.";

  if (/^source\b/.test(trimmed) || /^\.\s+\S/.test(trimmed)) return "Loads another script's variables/functions into the current shell session.";

  const fn = trimmed.match(/^(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{?$/);
  if (fn) return `Defines the function \`${fn[1]}\`.`;

  const forLoop = trimmed.match(/^for\s+([A-Za-z_]\w*)\s+in\s+([^;]+);?\s*do?$/);
  if (forLoop) return `Iterates over \`${forLoop[2].trim()}\`; on each pass, \`${forLoop[1]}\` represents the current item.`;
  if (/^while\b/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";

  const ifMatch = trimmed.match(/^if\s*\[\s*(.+?)\s*\]/) || trimmed.match(/^if\s+(.+?);?\s*then?$/);
  if (ifMatch) {
    const condition = ifMatch[1].trim();
    return `Checks whether \`${condition}\` is true before running the code that follows.`;
  }
  if (/^elif\b/.test(trimmed)) return "Checks another condition when the previous one was not met.";
  if (/^else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";

  const echo = trimmed.match(/^echo\s+(.+)$/);
  if (echo) {
    const arg = echo[1].trim();
    const varMatch = arg.match(/^"?\$\{?([A-Za-z_]\w*)\}?"?$/);
    if (varMatch && symbolTable.has(varMatch[1])) return `Prints ${symbolTable.describe(varMatch[1])} to the terminal.`;
    return `Prints \`${arg}\` to the terminal.`;
  }

  const decl = trimmed.match(/^([A-Za-z_]\w*)=(.+)$/);
  if (decl) return `Sets the variable \`${decl[1]}\` to \`${decl[2]}\`.`;

  if (["fi", "done", "}"].includes(trimmed)) return "Closes the current block (if/loop/function).";

  return genericFallbackExplanation();
}

export function findIssues(lines) {
  const issues = findCommonIssues(lines);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/rm\s+-rf\s+\//.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "This deletes files recursively from a root/broad path — double-check the target before running." });
    }
    if (/\$\w+/.test(line) && !/"\$/.test(line) && /\brm\b|\bcp\b|\bmv\b/.test(line)) {
      issues.push({ line: index + 1, type: "review", message: "An unquoted variable is used with a file-affecting command. Quoting (`\"$var\"`) avoids issues with spaces or globbing." });
    }
  });

  return issues;
}
