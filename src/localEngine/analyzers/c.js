import { isCommentLineExcludingHash as isCommentLine, commentExplanation, findCommonIssues, genericFallbackExplanation, explainAugmentedAssignment, explainIncrementDecrement, explainTernary, explainClassicForLoop , explainBareFunctionCall , explainLoneOpenBrace } from "../shared/patterns.js";

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

  const loneBrace = explainLoneOpenBrace(trimmed);
  if (loneBrace) return loneBrace;

  if (/^#include\s*<(.+)>/.test(trimmed)) {
    const m = trimmed.match(/^#include\s*<(.+)>/);
    return `Includes the \`${m[1]}\` header, giving access to its functions/macros.`;
  }

  const structDecl = trimmed.match(/^struct\s+([A-Za-z_]\w*)\s*\{?$/);
  if (structDecl) return `Defines the \`${structDecl[1]}\` struct, which can hold a group of related fields.`;

  // Function/return-type detection needs to accept multi-word types
  // (`struct Node *`, `unsigned long`, `const char *`) — a single
  // `[\w]+` was only ever matching one-word types like `int`/`void`,
  // so any function returning a pointer-to-struct (extremely common
  // in real C) fell straight through to the generic fallback.
  const TYPE = "(?:const\\s+)?(?:struct\\s+[A-Za-z_]\\w*|unsigned\\s+\\w+|[A-Za-z_]\\w*)";
  const fn = trimmed.match(new RegExp(`^(?:static\\s+)?${TYPE}\\s*\\*?\\s*([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)\\s*\\{?$`));
  if (fn && !/\b(if|for|while|switch|return)\b/.test(trimmed)) {
    return fn[2].trim()
      ? `Defines the function \`${fn[1]}\`, which accepts \`${fn[2].trim()}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  if (/^for\s*\(/.test(trimmed)) return explainClassicForLoop(trimmed) || "Starts a counted loop that repeats a block of code a set number of times.";
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

  const mallocMatch = trimmed.match(/^(?:const\s+)?(?:struct\s+[A-Za-z_]\w*|[A-Za-z_]\w*)\s*\*\s*([A-Za-z_]\w*)\s*=\s*\(?[\w\s*]*\)?\s*(?:m|c)alloc\s*\((.+)\)\s*;$/);
  if (mallocMatch) return `Declares the pointer \`${mallocMatch[1]}\` and allocates memory for it on the heap (\`${trimmed.includes("calloc") ? "calloc" : "malloc"}(${mallocMatch[2].trim()})\`) — this memory must later be released with \`free(${mallocMatch[1]})\`, or it leaks.`;

  const pointer = trimmed.match(new RegExp(`^${TYPE}\\s*\\*\\s*([A-Za-z_]\\w*)\\s*=\\s*(.+);`));
  if (pointer) return `Declares the pointer \`${pointer[1]}\` and points it at \`${pointer[2]}\`.`;

  // `ptr->field = value;` — assignment through a pointer to a struct
  // member. Worth calling out `->` specifically (rather than treating
  // it as an ordinary assignment) since dereferencing through a bad
  // pointer here is a classic C crash/undefined-behavior source.
  const arrowAssign = trimmed.match(/^([A-Za-z_]\w*)->([A-Za-z_]\w*)\s*=\s*(.+);$/);
  if (arrowAssign) return `Sets the \`${arrowAssign[2]}\` field of the struct that \`${arrowAssign[1]}\` points to, to \`${arrowAssign[3].trim()}\`.`;

  const decl = trimmed.match(/^(int|char|float|double|long|short)\s+([A-Za-z_]\w*)\s*=\s*(.+);/);
  if (decl) {
    const ternary = explainTernary(decl[2], decl[3]);
    if (ternary) return ternary;
    return `Declares a \`${decl[1]}\` variable \`${decl[2]}\` and assigns it \`${decl[3]}\`.`;
  }

  // Plain reassignment of an already-declared variable (`current = next;`)
  // — no type keyword, so it wouldn't match the typed-declaration rule
  // above, and previously had no rule of its own at all.
  const reassign = trimmed.match(/^([A-Za-z_]\w*)\s*=\s*(.+);$/);
  if (reassign) return `Sets \`${reassign[1]}\` to \`${reassign[2].trim()}\`.`;

  // Bare declaration, no initializer (`int value;`, `struct Node *next;`)
  // — this is how every struct field is written, so without it, every
  // field in every struct fell to the generic fallback.
  const bareDecl = trimmed.match(new RegExp(`^${TYPE}\\s*(\\*)?\\s*([A-Za-z_]\\w*)\\s*;$`));
  if (bareDecl) {
    const [, star, name] = bareDecl;
    return star
      ? `Declares the pointer \`${name}\` (not yet initialized/assigned).`
      : `Declares the variable \`${name}\` (not yet initialized/assigned).`;
  }

  if (["}", "};"].includes(trimmed)) return "Closes the current code block.";

  const incDec = explainIncrementDecrement(trimmed);
  if (incDec) return incDec;

  const augmented = explainAugmentedAssignment(trimmed, symbolTable, scope);
  if (augmented) return augmented;

  const bareCall = explainBareFunctionCall(trimmed, symbolTable, scope);
  if (bareCall) return bareCall;

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
    if (/\bsprintf\s*\(/.test(line)) {
      issues.push({ line: index + 1, type: "security", message: "`sprintf()` writes without checking buffer size and can overflow; use `snprintf()` with an explicit size instead." });
    }
    const cSystemCall = line.match(/\bsystem\s*\((.+)\)\s*;?$/);
    if (cSystemCall && !/^".*"$/.test(cSystemCall[1].trim())) {
      issues.push({ line: index + 1, type: "security", message: "`system()` is called with a non-literal argument. If any part comes from user input, this is a command-injection risk." });
    }
  });

  if (mallocLines.length && !hasFree) {
    mallocLines.forEach((line) =>
      issues.push({ line, type: "warning", message: "Memory allocated here (`malloc`/`calloc`) doesn't appear to be released with a matching `free()` anywhere in this snippet." })
    );
  }

  return issues;
}
