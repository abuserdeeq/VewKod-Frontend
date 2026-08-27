import { isCommentLine, commentExplanation, findCommonIssues, genericFallbackExplanation } from "../shared/patterns.js";

export const id = "rust";
export const label = "Rust";

// Function-level scoping (see shared/patterns.js computeLineScopes):
// Rust function bodies are brace-delimited.
export const scopeStyle = "brace";
export const functionStartRegex = /^(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(/;

export function detect(code) {
  return /\bfn\s+main\s*\(\s*\)/.test(code) || /\blet\s+mut\b/.test(code) || /\bprintln!\s*\(/.test(code);
}

function literalRole(value) {
  const v = value.trim();
  if (/^vec!\s*\[/.test(v) || /^\[.*\]$/.test(v)) return "list";
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

    const fn = line.match(/^(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) {
      symbolTable.add(fn[1], "function", { parameters: fn[2].trim() }, scope);
      const fnScope = `${scope}>${fn[1]}#${index}`;
      fn[2].split(",").map((p) => p.trim().split(/\s*:\s*/)[0].trim()).filter(Boolean).forEach((p) => symbolTable.add(p, "parameter", {}, fnScope));
    }

    const structDecl = line.match(/^(?:pub\s+)?struct\s+([A-Za-z_]\w*)/);
    if (structDecl) symbolTable.add(structDecl[1], "class", {}, scope);

    const decl = line.match(/^let\s+(?:mut\s+)?([A-Za-z_]\w*)\s*(?::\s*[\w<>]+)?\s*=\s*(.+);/);
    if (decl) symbolTable.add(decl[1], literalRole(decl[2]), {}, scope);

    // for item in &items / for item in items.iter()
    const forLoop = line.match(/^for\s+([A-Za-z_]\w*)\s+in\s+&?([A-Za-z_]\w*)/);
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
    if (/^use\s+[\w:]+;/.test(line)) result.imports.push(lineNumber);

    const fn = line.match(/^(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) result.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });

    const structDecl = line.match(/^(?:pub\s+)?struct\s+([A-Za-z_]\w*)/);
    if (structDecl) result.classes.push({ line: lineNumber, name: structDecl[1] });

    const decl = line.match(/^let\s+(?:mut\s+)?([A-Za-z_]\w*)/);
    if (decl) result.variables.push({ line: lineNumber, name: decl[1] });

    if (/^for\b/.test(line) || /^loop\b/.test(line) || /^while\b/.test(line)) result.loops.push(lineNumber);
    if (/^if\b/.test(line) || /^else\b/.test(line) || /^match\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^return\b/.test(line)) result.returns.push(lineNumber);
    if (/\bprintln!\s*\(/.test(line)) result.outputs.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine, symbolTable, scope = "global") {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  if (/^use\s+[\w:]+;/.test(trimmed)) return "Brings another module/crate's items into scope.";

  const structDecl = trimmed.match(/^(?:pub\s+)?struct\s+([A-Za-z_]\w*)/);
  if (structDecl) return `Defines the \`${structDecl[1]}\` struct, which can hold a group of related fields.`;

  const fn = trimmed.match(/^(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
  if (fn) {
    return fn[2].trim()
      ? `Defines the function \`${fn[1]}\`, which accepts \`${fn[2].trim()}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  const forLoop = trimmed.match(/^for\s+([A-Za-z_]\w*)\s+in\s+&?([A-Za-z_]\w*)/);
  if (forLoop) {
    const info = symbolTable.get(forLoop[2], scope);
    const phrase = info && info.role === "list" ? `the \`${forLoop[2]}\` collection` : `\`${forLoop[2]}\``;
    return `Iterates over ${phrase}; on each pass, \`${forLoop[1]}\` represents the current item.`;
  }
  if (/^loop\s*\{?$/.test(trimmed)) return "Starts an intentionally infinite loop, exited with `break` elsewhere.";
  if (/^while\s+/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";

  const ifMatch = trimmed.match(/^if\s+(.+?)\s*\{?$/);
  if (ifMatch) {
    const condition = ifMatch[1].trim();
    const known = symbolTable.knownIdentifiersIn(condition, scope);
    if (known.length === 1 && condition === known[0]) return `Checks whether ${symbolTable.describe(known[0], scope)} meets the condition before running the code that follows.`;
    return `Checks whether \`${condition}\` is true before running the code that follows.`;
  }
  if (/^\}?\s*else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";
  if (/^match\s+/.test(trimmed)) return "Starts a match expression that picks a branch based on the value's pattern.";

  const ret = trimmed.match(/^return\b\s*(.*?);?$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current function.` : "Returns control from the current function.";

  const print = trimmed.match(/\bprintln!\s*\((.*)\)\s*;?$/);
  if (print) return `Prints \`${print[1].trim()}\` to standard output, followed by a newline.`;

  const decl = trimmed.match(/^let\s+(mut\s+)?([A-Za-z_]\w*)\s*(?::\s*[\w<>]+)?\s*=\s*(.+);/);
  if (decl) return `Declares ${decl[1] ? "a mutable" : "an immutable"} binding \`${decl[2]}\` and assigns it \`${decl[3]}\`.`;

  if (["}"].includes(trimmed)) return "Closes the current code block.";

  // A line with no trailing `;` and not opening/closing a block is
  // very likely Rust's implicit-return expression (the value of the
  // last expression in a block is returned automatically).
  if (!trimmed.endsWith(";") && !trimmed.endsWith("{")) {
    return `Evaluates \`${trimmed}\` as the value returned from this block (Rust's implicit-return syntax — no \`return\` keyword needed).`;
  }

  return genericFallbackExplanation();
}

export function findIssues(lines) {
  const issues = findCommonIssues(lines);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/\.unwrap\s*\(\s*\)/.test(line)) {
      issues.push({ line: index + 1, type: "warning", message: "`.unwrap()` panics if the value is `None`/`Err`. Consider handling the error case explicitly." });
    }
  });

  return issues;
}
