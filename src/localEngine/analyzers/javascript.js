import { isCommentLine, commentExplanation, findCommonIssues, countUsages, genericFallbackExplanation, mdCode } from "../shared/patterns.js";

export const id = "javascript";
export const label = "JavaScript";

// Function-level scoping (see shared/patterns.js computeLineScopes):
// JS/TS-family blocks are brace-delimited. Matches both
// `function name(...)` and `const name = (...) =>` function starts;
// when the arrow form matches, the name lands in group 2 instead of
// group 1 — computeLineScopes falls back to a generic scope label in
// that case, which is fine since only uniqueness (via line index)
// matters for isolating one function's variables from another's.
export const scopeStyle = "brace";
export const functionStartRegex = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/;

export function detect(code) {
  return (
    /\b(const|let|var|console\.log|=>|function)\b/.test(code) ||
    (/\b(import|export)\b.*\b(from|default)\b/.test(code) && !/:\s*(string|number|boolean)\b/.test(code))
  );
}

function literalRole(value) {
  const v = value.trim().replace(/;$/, "");
  if (/^\[.*\]$/s.test(v)) return "list";
  if (/^\{.*\}$/s.test(v)) return "dict";
  if (/^["'`].*["'`]$/.test(v)) return "string";
  if (/^(true|false)$/.test(v)) return "boolean";
  if (/^-?\d+(\.\d+)?$/.test(v)) return "number";
  if (/^new\s+Map\s*\(/.test(v)) return "dict";
  if (/^new\s+Set\s*\(/.test(v)) return "set";
  return "variable";
}

export function buildSymbolTable(lines, symbolTable, lineScopes = []) {
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || isCommentLine(line)) return;

    const scope = lineScopes[index] || "global";

    const fn = line.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/);
    if (fn) {
      symbolTable.add(fn[1], "function", { parameters: fn[2].trim() }, scope);
      const fnScope = `${scope}>${fn[1]}#${index}`;
      fn[2].split(",").map((p) => p.trim().split("=")[0].trim()).filter(Boolean).forEach((p) => symbolTable.add(p, "parameter", {}, fnScope));
    }

    const arrow = line.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
    if (arrow) {
      symbolTable.add(arrow[1], "function", { parameters: arrow[2].trim() }, scope);
      const fnScope = `${scope}>fn#${index}`; // matches computeLineScopes' fallback label for the arrow form
      arrow[2].split(",").map((p) => p.trim().split("=")[0].trim()).filter(Boolean).forEach((p) => symbolTable.add(p, "parameter", {}, fnScope));
    }

    const cls = line.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
    if (cls) symbolTable.add(cls[1], "class", {}, scope);

    // for...of / for...in
    const forOf = line.match(/^for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+([A-Za-z_$][\w$.]*)\s*\)/);
    if (forOf) {
      const sourceName = forOf[2].split(".")[0];
      const sourceInfo = symbolTable.get(sourceName, scope);
      symbolTable.add(forOf[1], "loop-item", { of: sourceName, ofType: sourceInfo ? sourceInfo.role : "collection" }, scope);
    }

    // array.forEach((item) => ...) or (item, index) => ...
    const forEach = line.match(/([A-Za-z_$][\w$]*)\.forEach\s*\(\s*(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/);
    if (forEach) {
      const sourceName = forEach[1];
      const sourceInfo = symbolTable.get(sourceName, scope);
      const params = (forEach[2] ?? forEach[3] ?? "").split(",").map((p) => p.trim()).filter(Boolean);
      if (params[0]) symbolTable.add(params[0], "loop-item", { of: sourceName, ofType: sourceInfo ? sourceInfo.role : "array" }, scope);
    }

    const assign = line.match(/^(?:export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);?$/);
    if (assign) {
      symbolTable.add(assign[2], literalRole(assign[3]), { keyword: assign[1] }, scope);
    }
  });

  return symbolTable;
}

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

    const fn = line.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/);
    if (fn) result.functions.push({ line: lineNumber, name: fn[1], parameters: fn[2] });

    const arrow = line.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
    if (arrow) result.functions.push({ line: lineNumber, name: arrow[1], parameters: arrow[2] });

    const cls = line.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
    if (cls) result.classes.push({ line: lineNumber, name: cls[1] });

    if (/^import\b/.test(line) || /\brequire\s*\(/.test(line)) result.imports.push(lineNumber);

    const varMatch = line.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (varMatch) result.variables.push({ line: lineNumber, name: varMatch[1] });

    if (/^(for|while)\b/.test(line) || /\bforEach\s*\(/.test(line)) result.loops.push(lineNumber);
    if (/^if\s*\(/.test(line) || /^(else|switch|case)\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^return\b/.test(line)) result.returns.push(lineNumber);
    if (/\bconsole\.(log|error|warn|info|debug)\s*\(/.test(line)) result.outputs.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine, symbolTable, scope = "global") {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  if (/^import\b/.test(trimmed) || /\brequire\s*\(/.test(trimmed)) {
    return "Imports a library, module, or dependency so functionality from another file/package can be used.";
  }

  const fn = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/);
  if (fn) {
    const params = fn[2].trim();
    return params
      ? `Defines the function \`${fn[1]}\`, which accepts \`${params}\` as parameter(s).`
      : `Defines the function \`${fn[1]}\` without parameters.`;
  }

  const arrow = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/);
  if (arrow) {
    const params = (arrow[2] ?? arrow[3] ?? "").trim();
    return params
      ? `Defines the arrow function \`${arrow[1]}\`, which accepts \`${params}\` as parameter(s).`
      : `Defines the arrow function \`${arrow[1]}\`.`;
  }

  const cls = trimmed.match(/^class\s+([A-Za-z_$][\w$]*)/);
  if (cls) return `Defines the class \`${cls[1]}\`, which can serve as a blueprint for creating objects.`;

  const forOf = trimmed.match(/^for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+([A-Za-z_$][\w$.]*)\s*\)/);
  if (forOf) {
    const sourceName = forOf[2].split(".")[0];
    const info = symbolTable.get(sourceName, scope);
    const phrase = info && info.role === "list" ? `the \`${sourceName}\` array` : `\`${sourceName}\``;
    return `Iterates over ${phrase}; on each pass, \`${forOf[1]}\` represents the current item.`;
  }

  const forEach = trimmed.match(/([A-Za-z_$][\w$]*)\.forEach\s*\(\s*(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/);
  if (forEach) {
    const params = (forEach[2] ?? forEach[3] ?? "").split(",").map((p) => p.trim());
    const info = symbolTable.get(forEach[1], scope);
    const phrase = info && info.role === "list" ? `the \`${forEach[1]}\` array` : `\`${forEach[1]}\``;
    return `Loops over ${phrase} using \`.forEach()\`; \`${params[0]}\` represents the current item on each pass.`;
  }

  if (/^for\s*\(/.test(trimmed)) {
    return "Starts a counted loop that repeats a block of code a set number of times.";
  }
  if (/^while\s*\(\s*true\s*\)/.test(trimmed)) {
    return "Starts an intentionally infinite loop, which must be exited with a `break` or `return` elsewhere.";
  }
  if (/^while\s*\(/.test(trimmed)) {
    return "Starts a while loop that keeps running while its condition stays true.";
  }

  const ifMatch = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
  if (ifMatch) {
    const condition = ifMatch[1].trim();
    const known = symbolTable.knownIdentifiersIn(condition, scope);
    if (known.length === 1 && condition === known[0]) {
      return `Checks whether ${symbolTable.describe(known[0], scope)} is truthy before running the code that follows.`;
    }
    return `Checks whether ${mdCode(condition)} is true before running the code that follows.`;
  }
  if (/^\}?\s*else\s+if\s*\(/.test(trimmed)) return "Checks another condition when the previous one was not met.";
  if (/^\}?\s*else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";
  if (/^switch\s*\(/.test(trimmed)) return "Starts a switch statement that selects a block of code based on a value.";
  if (/^case\s+/.test(trimmed)) return "Defines one possible case inside a switch statement.";

  if (/^try\s*\{?$/.test(trimmed)) {
    return "Starts a `try` block; if an error occurs anywhere inside it, execution jumps to the matching `catch` block below.";
  }

  const catchMatch = trimmed.match(/^\}?\s*catch\s*(?:\(([^)]*)\))?\s*\{?$/);
  if (catchMatch) {
    const errName = (catchMatch[1] || "").trim();
    return errName
      ? `Catches any error thrown in the \`try\` block above, made available here as \`${errName}\`.`
      : "Catches any error thrown in the `try` block above.";
  }

  if (/^\}?\s*finally\s*\{?$/.test(trimmed)) {
    return "Starts a `finally` block, which always runs after the `try`/`catch`, whether or not an error occurred.";
  }

  const throwMatch = trimmed.match(/^throw\s+(.+?);?$/);
  if (throwMatch) {
    return `Throws an error (${mdCode(throwMatch[1].trim())}), stopping normal execution here so it can be caught by an enclosing \`try\`/\`catch\`.`;
  }

  const ret = trimmed.match(/^return\b\s*(.*?);?$/);
  if (ret) {
    const value = ret[1].trim();
    if (!value) return "Returns control from the current function without a value.";
    const known = symbolTable.knownIdentifiersIn(value, scope);
    if (known.length === 1 && value === known[0]) return `Returns ${symbolTable.describe(known[0], scope)} from the current function.`;
    return `Returns ${mdCode(value)} from the current function.`;
  }

  const log = trimmed.match(/\bconsole\.(log|error|warn|info|debug)\s*\((.*)\)\s*;?$/);
  if (log) {
    const [, method, argsRaw] = log;
    const arg = argsRaw.trim();
    const known = symbolTable.knownIdentifiersIn(arg, scope);
    const argPhrase = known.length === 1 && arg === known[0]
      ? symbolTable.describe(known[0], scope)
      : (arg ? mdCode(arg) : null);

    if (method === "log") {
      return argPhrase ? `Displays ${argPhrase} in the browser/console.` : "Prints a blank line to the console.";
    }
    const verb = {
      error: "Logs an error",
      warn: "Logs a warning",
      info: "Logs an informational message",
      debug: "Logs a debug message",
    }[method];
    return argPhrase ? `${verb} (${argPhrase}) to the console.` : `${verb} to the console.`;
  }

  const declared = trimmed.match(/^(?:export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);?$/);
  if (declared) {
    const [, keyword, name, value] = declared;
    const info = symbolTable.get(name, scope);
    if (info && info.role === "list") return `Creates the \`${keyword}\` array \`${name}\` containing ${mdCode(value)}.`;
    if (info && info.role === "dict") return `Creates the \`${keyword}\` object \`${name}\` with the properties ${mdCode(value)}.`;
    return `Declares the \`${keyword}\` variable \`${name}\` and assigns it ${mdCode(value)}.`;
  }

  const call = trimmed.match(/^([A-Za-z_$][\w$]*)\s*\((.*)\)\s*;?$/);
  if (call) {
    const info = symbolTable.get(call[1], scope);
    const label = info && info.role === "function" ? `the \`${call[1]}()\` function defined above` : `\`${call[1]}()\``;
    return call[2].trim() ? `Calls ${label} with the provided argument(s).` : `Calls ${label} without arguments.`;
  }

  if (["}", "};", ")", "];"].includes(trimmed)) return "Closes the current code block or structural section.";

  return genericFallbackExplanation();
}

export function findIssues(lines, symbolTable) {
  const issues = findCommonIssues(lines);

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;

    if (/[^=!]==[^=]/.test(line)) {
      issues.push({ line: lineNumber, type: "review", message: "Uses `==` for comparison. `===` (strict equality) is usually safer since it avoids implicit type coercion." });
    }

    if (/\bvar\s+/.test(line)) {
      issues.push({ line: lineNumber, type: "review", message: "Uses `var`. `let` or `const` have more predictable (block) scoping and are generally preferred." });
    }

    const emptyFn = /^(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*\{\s*\}?$/.test(line);
    if (emptyFn && /\{\s*\}$/.test(line)) {
      issues.push({ line: lineNumber, type: "warning", message: "This function appears to have no implementation yet." });
    }
  });

  symbolTable.symbols.forEach((info) => {
    // Functions/classes are commonly defined without being called within
    // the same standalone snippet (e.g. a utility extracted from a larger
    // file) — flagging that as "unused" produces a false positive on
    // almost every single-function snippet, so only variables are checked.
    if (["parameter", "loop-item", "function", "class"].includes(info.role)) return;
    const name = info.name;
    if (countUsages(lines, name) <= 1) {
      const defLine = lines.findIndex((l) => new RegExp(`\\b${name}\\b`).test(l));
      issues.push({ line: defLine + 1, type: "review", message: `Variable \`${name}\` appears to be declared but may not be used later.` });
    }
  });

  return issues;
}
