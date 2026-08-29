import { isCommentLine, commentExplanation, findCommonIssues, genericFallbackExplanation, explainAugmentedAssignment, explainIncrementDecrement } from "../shared/patterns.js";

export const id = "java";
export const label = "Java";

// Function-level scoping (see shared/patterns.js computeLineScopes):
// Java method bodies are brace-delimited.
export const scopeStyle = "brace";
export const functionStartRegex = /^(?:public|private|protected)?\s*(?:static\s+)?[\w<>\[\]]+\s+([A-Za-z_$][\w$]*)\s*\(/;

export function detect(code) {
  return /\b(public|private|protected)\b/.test(code) && /\b(class|static|void|int|String)\b/.test(code);
}

const COLLECTION_TYPES = /^(ArrayList|List|LinkedList)\s*<.*>$/;
const MAP_TYPES = /^(HashMap|Map|TreeMap)\s*<.*>$/;

function typeRole(type) {
  const t = type.trim();
  if (COLLECTION_TYPES.test(t)) return "list";
  if (MAP_TYPES.test(t)) return "dict";
  if (t === "String") return "string";
  if (["int", "long", "double", "float", "short", "Integer", "Double"].includes(t)) return "number";
  if (t === "boolean" || t === "Boolean") return "boolean";
  return "variable";
}

export function buildSymbolTable(lines, symbolTable, lineScopes = []) {
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || isCommentLine(line)) return;

    const scope = lineScopes[index] || "global";

    const cls = line.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
    if (cls) symbolTable.add(cls[1], "class", {}, scope);

    const method = line.match(/^(?:public|private|protected)?\s*(?:static\s+)?[\w<>\[\]]+\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{?$/);
    if (method && !/\b(if|for|while|switch)\b/.test(line)) {
      symbolTable.add(method[1], "function", { parameters: method[2].trim() }, scope);
      const fnScope = `${scope}>${method[1]}#${index}`;
      method[2].split(",").map((p) => p.trim().split(/\s+/).pop()).filter(Boolean).forEach((p) => symbolTable.add(p, "parameter", {}, fnScope));
    }

    // Type varName = value;
    const decl = line.match(/^(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?([\w<>\[\], ]+?)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+);/);
    if (decl) symbolTable.add(decl[2], typeRole(decl[1]), {}, scope);

    // enhanced for: for (Type item : items)
    const forEach = line.match(/^for\s*\(\s*[\w<>\[\]]+\s+([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\s*\)/);
    if (forEach) {
      const info = symbolTable.get(forEach[2], scope);
      symbolTable.add(forEach[1], "loop-item", { of: forEach[2], ofType: info ? info.role : "collection" }, scope);
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

    const cls = line.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
    if (cls) result.classes.push({ line: lineNumber, name: cls[1] });

    const method = line.match(/^(?:public|private|protected)?\s*(?:static\s+)?[\w<>\[\]]+\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{?$/);
    if (method && !/\b(if|for|while|switch)\b/.test(line)) result.functions.push({ line: lineNumber, name: method[1], parameters: method[2] });

    if (/^import\b/.test(line)) result.imports.push(lineNumber);
    if (/^(for|while)\b/.test(line)) result.loops.push(lineNumber);
    if (/^if\s*\(/.test(line) || /^(else|switch|case)\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^return\b/.test(line)) result.returns.push(lineNumber);
    if (/System\.out\.print/.test(line)) result.outputs.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine, symbolTable, scope = "global") {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  if (/^import\b/.test(trimmed)) return "Imports a class or package so it can be used in this file.";

  const cls = trimmed.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
  if (cls) return `Defines the class \`${cls[1]}\`, which can serve as a blueprint for creating objects.`;

  const method = trimmed.match(/^(?:public|private|protected)?\s*(?:static\s+)?([\w<>\[\]]+)\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{?$/);
  if (method && !/\b(if|for|while|switch)\b/.test(trimmed)) {
    const [, returnType, name, params] = method;
    return params.trim()
      ? `Defines the method \`${name}\`, which accepts \`${params.trim()}\` and returns \`${returnType}\`.`
      : `Defines the method \`${name}\`, which returns \`${returnType}\` and takes no parameters.`;
  }

  const forEach = trimmed.match(/^for\s*\(\s*[\w<>\[\]]+\s+([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\s*\)/);
  if (forEach) {
    const info = symbolTable.get(forEach[2], scope);
    const phrase = info && info.role === "list" ? `the \`${forEach[2]}\` list` : `\`${forEach[2]}\``;
    return `Iterates over ${phrase}; on each pass, \`${forEach[1]}\` represents the current item.`;
  }

  if (/^for\s*\(/.test(trimmed)) return "Starts a counted loop that repeats a block of code a set number of times.";
  if (/^while\s*\(/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";

  const ifMatch = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
  if (ifMatch) {
    const condition = ifMatch[1].trim();
    const known = symbolTable.knownIdentifiersIn(condition, scope);
    if (known.length === 1 && condition === known[0]) return `Checks whether ${symbolTable.describe(known[0], scope)} meets the condition before running the code that follows.`;
    return `Checks whether \`${condition}\` is true before running the code that follows.`;
  }
  if (/^\}?\s*else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";

  const ret = trimmed.match(/^return\b\s*(.*?);?$/);
  if (ret) {
    const value = ret[1].trim();
    return value ? `Returns \`${value}\` from the current method.` : "Returns control from the current method (void).";
  }

  const print = trimmed.match(/System\.out\.println?\s*\((.*)\)\s*;?$/);
  if (print) return `Prints \`${print[1].trim()}\` to the console.`;

  const decl = trimmed.match(/^(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?([\w<>\[\], ]+?)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+);/);
  if (decl) return `Declares a \`${decl[1].trim()}\` variable \`${decl[2]}\` and assigns it \`${decl[3]}\`.`;

  if (["}", "};"].includes(trimmed)) return "Closes the current code block.";

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
    if (/catch\s*\(\s*Exception\s+\w+\s*\)/.test(line)) {
      issues.push({ line: index + 1, type: "warning", message: "Catches the broad `Exception` type. Catching more specific exceptions is usually safer." });
    }
    if (/\bpublic\s+static\s+void\s+main\b/.test(line) === false && /==\s*"/.test(line)) {
      issues.push({ line: index + 1, type: "review", message: "Compares a `String` using `==`, which checks reference equality, not content. Use `.equals()` instead." });
    }
  });

  return issues;
}
