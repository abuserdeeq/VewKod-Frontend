import { isCommentLine, commentExplanation, findCommonIssues, genericFallbackExplanation, explainAugmentedAssignment, explainTernary, explainMultipleAssignment } from "../shared/patterns.js";

export const id = "ruby";
export const label = "Ruby";

// Function-level scoping (see shared/patterns.js computeLineScopes):
// Ruby methods are closed with `end`, not braces.
export const scopeStyle = "end";
export const functionStartRegex = /^def\s+([A-Za-z_]\w*[?!]?)/;

export function detect(code) {
  return /\bputs\b/.test(code) || /\bdef\s+\w+.*\bend\b/s.test(code) || /\.each\s+do\s*\|/.test(code);
}

function literalRole(value) {
  const v = value.trim();
  if (/^\[.*\]$/s.test(v)) return "list";
  if (/^\{.*\}$/s.test(v)) return "dict";
  if (/^["'].*["']$/.test(v)) return "string";
  if (/^(true|false)$/.test(v)) return "boolean";
  if (/^-?\d+(\.\d+)?$/.test(v)) return "number";
  return "variable";
}

export function buildSymbolTable(lines, symbolTable, lineScopes = []) {
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || isCommentLine(line)) return;

    const scope = lineScopes[index] || "global";

    const fn = line.match(/^def\s+([A-Za-z_]\w*[?!]?)(?:\(([^)]*)\))?/);
    if (fn) {
      symbolTable.add(fn[1], "function", { parameters: (fn[2] || "").trim() }, scope);
      const fnScope = `${scope}>${fn[1]}#${index}`;
      (fn[2] || "").split(",").map((p) => p.trim().split("=")[0].trim()).filter(Boolean).forEach((p) => symbolTable.add(p, "parameter", {}, fnScope));
    }

    const cls = line.match(/^class\s+([A-Za-z_]\w*)/);
    if (cls) symbolTable.add(cls[1], "class", {}, scope);

    const multiAssign = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*=\s*(.+)$/);
    if (multiAssign) {
      multiAssign[1].split(",").map((t) => t.trim()).forEach((t) => symbolTable.add(t, "variable", {}, scope));
    }

    const assign = line.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (assign && !/^(if|elsif|while|for|def|class)\b/.test(line)) symbolTable.add(assign[1], literalRole(assign[2]), {}, scope);

    // items.each do |item|
    const each = line.match(/^([A-Za-z_]\w*)\.each\s+do\s*\|\s*([A-Za-z_]\w*)\s*\|/);
    if (each) {
      const info = symbolTable.get(each[1], scope);
      symbolTable.add(each[2], "loop-item", { of: each[1], ofType: info ? info.role : "collection" }, scope);
    }

    // for item in items
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
    if (/^require\b/.test(line)) result.imports.push(lineNumber);

    const fn = line.match(/^def\s+([A-Za-z_]\w*[?!]?)/);
    if (fn) result.functions.push({ line: lineNumber, name: fn[1], parameters: "" });

    const cls = line.match(/^class\s+([A-Za-z_]\w*)/);
    if (cls) result.classes.push({ line: lineNumber, name: cls[1] });

    const multiAssign = line.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*=\s*/);
    if (multiAssign) {
      multiAssign[1].split(",").map((t) => t.trim()).forEach((name) => result.variables.push({ line: lineNumber, name }));
    }

    const assign = line.match(/^([A-Za-z_]\w*)\s*=\s*/);
    if (assign && !/^(if|elsif|while|for|def)\b/.test(line)) result.variables.push({ line: lineNumber, name: assign[1] });

    if (/^(for|while)\b/.test(line) || /\.each\s+do\b/.test(line)) result.loops.push(lineNumber);
    if (/^(if|elsif|else|unless)\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^return\b/.test(line)) result.returns.push(lineNumber);
    if (/\bputs\b/.test(line)) result.outputs.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine, symbolTable, scope = "global") {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  if (/^require\b/.test(trimmed)) return "Loads another Ruby file/library so its code becomes available here.";

  const cls = trimmed.match(/^class\s+([A-Za-z_]\w*)/);
  if (cls) return `Defines the class \`${cls[1]}\`, which can serve as a blueprint for creating objects.`;

  const fn = trimmed.match(/^def\s+([A-Za-z_]\w*[?!]?)(?:\(([^)]*)\))?/);
  if (fn) {
    const params = (fn[2] || "").trim();
    return params
      ? `Defines the method \`${fn[1]}\`, which accepts \`${params}\` as parameter(s).`
      : `Defines the method \`${fn[1]}\` without parameters.`;
  }

  const each = trimmed.match(/^([A-Za-z_]\w*)\.each\s+do\s*\|\s*([A-Za-z_]\w*)\s*\|/);
  if (each) {
    const info = symbolTable.get(each[1], scope);
    const phrase = info && info.role === "list" ? `the \`${each[1]}\` array` : `\`${each[1]}\``;
    return `Iterates over ${phrase} using \`.each\`; \`${each[2]}\` represents the current item on each pass.`;
  }

  const forLoop = trimmed.match(/^for\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)/);
  if (forLoop) {
    const info = symbolTable.get(forLoop[2], scope);
    const phrase = info && info.role === "list" ? `the \`${forLoop[2]}\` array` : `\`${forLoop[2]}\``;
    return `Iterates over ${phrase}; on each pass, \`${forLoop[1]}\` represents the current item.`;
  }

  if (/^while\s+/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";

  const ifMatch = trimmed.match(/^if\s+(.+)$/) || trimmed.match(/^elsif\s+(.+)$/) || trimmed.match(/^unless\s+(.+)$/);
  if (ifMatch) {
    const condition = ifMatch[1].trim();
    const negate = /^unless\b/.test(trimmed);
    const known = symbolTable.knownIdentifiersIn(condition, scope);
    if (known.length === 1 && condition === known[0]) {
      return `Checks whether ${symbolTable.describe(known[0], scope)} is ${negate ? "falsy" : "truthy"} before running the code that follows.`;
    }
    return `Checks whether \`${condition}\` is ${negate ? "false" : "true"} before running the code that follows.`;
  }
  if (/^else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition was not met.";

  const ret = trimmed.match(/^return\b\s*(.*)$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current method.` : "Returns control from the current method.";

  const puts = trimmed.match(/^puts\s+(.+)$/);
  if (puts) {
    const arg = puts[1].trim();
    const known = symbolTable.knownIdentifiersIn(arg, scope);
    if (known.length === 1 && arg === known[0]) return `Displays ${symbolTable.describe(known[0], scope)} as program output.`;
    return `Displays \`${arg}\` as program output.`;
  }

  const multiAssign = explainMultipleAssignment(trimmed);
  if (multiAssign) return multiAssign;

  const assign = trimmed.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
  if (assign && !/^(if|elsif|while|for|def|class)\b/.test(trimmed)) {
    const info = symbolTable.get(assign[1], scope);
    const ternary = explainTernary(assign[1], assign[2]);
    if (ternary) return ternary;
    if (info && info.role === "list") return `Creates the array \`${assign[1]}\` containing \`${assign[2]}\`.`;
    return `Assigns \`${assign[2]}\` to the variable \`${assign[1]}\`.`;
  }

  if (trimmed === "end") return "Closes the current block (method, class, loop, or conditional).";

  const augmented = explainAugmentedAssignment(trimmed, symbolTable, scope);
  if (augmented) return augmented;

  return genericFallbackExplanation();
}

export function findIssues(lines) {
  return findCommonIssues(lines);
}
