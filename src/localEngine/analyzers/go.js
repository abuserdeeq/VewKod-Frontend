import { isCommentLine, commentExplanation, findCommonIssues, genericFallbackExplanation, explainAugmentedAssignment, explainIncrementDecrement, explainGoForLoop } from "../shared/patterns.js";

export const id = "go";
export const label = "Go";

// Function-level scoping (see shared/patterns.js computeLineScopes):
// Go function bodies are brace-delimited.
export const scopeStyle = "brace";
export const functionStartRegex = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/;

export function detect(code) {
  return /^\s*package\s+\w+/m.test(code) || /\bfunc\s+main\s*\(\s*\)/.test(code) || /\bfmt\.(Println|Printf|Print)\s*\(/.test(code);
}

function literalRole(value) {
  const v = value.trim();
  if (/^\[\]/.test(v)) return "list";
  if (/^map\[/.test(v)) return "dict";
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

    const fn = line.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) {
      symbolTable.add(fn[1], "function", { parameters: fn[2].trim() }, scope);
      const fnScope = `${scope}>${fn[1]}#${index}`;
      // Go params look like "a, b int" or "a int, b string" — grab identifiers before each type.
      fn[2].split(",").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean).forEach((p) => symbolTable.add(p, "parameter", {}, fnScope));
    }

    const shortDecl = line.match(/^([A-Za-z_]\w*)\s*:=\s*(.+)$/);
    if (shortDecl) symbolTable.add(shortDecl[1], literalRole(shortDecl[2]), {}, scope);

    const multiDecl = line.match(/^([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*:=\s*(.+)$/);
    if (multiDecl) {
      symbolTable.add(multiDecl[1], "variable", {}, scope);
      symbolTable.add(multiDecl[2], "variable", {}, scope);
    }

    const varDecl = line.match(/^var\s+([A-Za-z_]\w*)\s+(\[\]\w+|map\[\w+\]\w+|\w+)/);
    if (varDecl) {
      const t = varDecl[2];
      const role = t.startsWith("[]") ? "list" : t.startsWith("map[") ? "dict" : t === "string" ? "string" : t === "bool" ? "boolean" : "number";
      symbolTable.add(varDecl[1], role, {}, scope);
    }

    // for _, item := range items  OR  for i, item := range items
    const rangeLoop = line.match(/^for\s+(?:([A-Za-z_]\w*)\s*,\s*)?([A-Za-z_]\w*)\s*:=\s*range\s+([A-Za-z_]\w*)/);
    if (rangeLoop) {
      const info = symbolTable.get(rangeLoop[3], scope);
      symbolTable.add(rangeLoop[2], "loop-item", { of: rangeLoop[3], ofType: info ? info.role : "collection" }, scope);
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
    if (/^import\b/.test(line) || /^\s*"[\w/]+"\s*$/.test(line)) result.imports.push(lineNumber);

    const fn = line.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) result.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });

    const typeDecl = line.match(/^type\s+([A-Za-z_]\w*)\s+struct/);
    if (typeDecl) result.classes.push({ line: lineNumber, name: typeDecl[1] });

    const shortDecl = line.match(/^([A-Za-z_]\w*)\s*:=/);
    if (shortDecl) result.variables.push({ line: lineNumber, name: shortDecl[1] });

    if (/^for\b/.test(line)) result.loops.push(lineNumber);
    if (/^if\b/.test(line) || /^else\b/.test(line) || /^switch\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^return\b/.test(line)) result.returns.push(lineNumber);
    if (/\bfmt\.(Println|Printf|Print)\s*\(/.test(line)) result.outputs.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine, symbolTable, scope = "global") {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  if (/^package\s+\w+/.test(trimmed)) return "Declares which package this file belongs to.";
  if (/^import\b/.test(trimmed)) return "Starts an import block, bringing in other packages.";
  if (/^\s*"[\w/]+"\s*$/.test(trimmed)) return `Imports the \`${trimmed.replace(/"/g, "")}\` package.`;

  const typeDecl = trimmed.match(/^type\s+([A-Za-z_]\w*)\s+struct/);
  if (typeDecl) return `Defines the \`${typeDecl[1]}\` struct, which can hold a group of related fields.`;

  const fn = trimmed.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/);
  if (fn) {
    return fn[2].trim()
      ? `Defines the function \`${fn[1]}\`, which accepts \`${fn[2].trim()}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  const rangeLoop = trimmed.match(/^for\s+(?:([A-Za-z_]\w*)\s*,\s*)?([A-Za-z_]\w*)\s*:=\s*range\s+([A-Za-z_]\w*)/);
  if (rangeLoop) {
    const info = symbolTable.get(rangeLoop[3], scope);
    const phrase = info && info.role === "list" ? `the \`${rangeLoop[3]}\` slice` : `\`${rangeLoop[3]}\``;
    return `Iterates over ${phrase}; on each pass, \`${rangeLoop[2]}\` represents the current item.`;
  }
  if (/^for\b/.test(trimmed)) return explainGoForLoop(trimmed) || "Starts a loop that repeats a block of code.";

  const ifMatch = trimmed.match(/^if\s+(.+?)\s*\{?$/);
  if (ifMatch) {
    const condition = ifMatch[1].trim();
    const known = symbolTable.knownIdentifiersIn(condition, scope);
    if (known.length === 1 && condition === known[0]) return `Checks whether ${symbolTable.describe(known[0], scope)} meets the condition before running the code that follows.`;
    return `Checks whether \`${condition}\` is true before running the code that follows.`;
  }
  if (/^\}?\s*else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";

  const ret = trimmed.match(/^return\b\s*(.*)$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current function.` : "Returns control from the current function.";

  const print = trimmed.match(/\bfmt\.(Println|Printf|Print)\s*\((.*)\)\s*$/);
  if (print) return `Prints \`${print[2].trim()}\` to standard output.`;

  const shortDecl = trimmed.match(/^([A-Za-z_]\w*)\s*:=\s*(.+)$/);
  if (shortDecl) return `Declares and initializes \`${shortDecl[1]}\` with \`${shortDecl[2]}\` (type inferred by Go).`;

  // multi-value short decl: result, err := someFunc(...)
  const multiDecl = trimmed.match(/^([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*:=\s*(.+)$/);
  if (multiDecl) {
    const [, first, second, callExpr] = multiDecl;
    const isErrPattern = second === "err";
    return isErrPattern
      ? `Calls \`${callExpr.trim()}\`, storing the result in \`${first}\` and any error in \`${second}\`.`
      : `Calls \`${callExpr.trim()}\`, assigning the results to \`${first}\` and \`${second}\`.`;
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
    const line = rawLine.trim();
    if (/,\s*err\s*:=/.test(line) || /,\s*err\s*=/.test(line)) {
      const handledNearby = lines.slice(index, index + 3).some((l) => /\bif\s+err\s*!=\s*nil\b/.test(l));
      if (!handledNearby) {
        issues.push({ line: index + 1, type: "warning", message: "An `err` value is assigned here but doesn't appear to be checked with `if err != nil` right after." });
      }
    }

    // exec.Command with a shell invoked via sh -c and a built (not
    // literal) command string is a command-injection sink.
    if (/\bexec\.Command\s*\(/.test(line) && /"(sh|bash)"/.test(line) && /(\+|Sprintf)/.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "`exec.Command` invokes a shell with a built command string. If any part comes from user input, this is a command-injection risk — pass the program and arguments separately instead of going through `sh -c`." });
    }
  });

  return issues;
}
