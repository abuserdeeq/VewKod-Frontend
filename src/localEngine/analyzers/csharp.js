import { isCommentLine, commentExplanation, findCommonIssues, genericFallbackExplanation } from "../shared/patterns.js";

export const id = "csharp";
export const label = "C#";

export function detect(code) {
  return /\busing\s+System\b/.test(code) || /\bConsole\.(Write|WriteLine)\s*\(/.test(code) || /\bnamespace\s+\w+/.test(code);
}

const COLLECTION_TYPES = /^(List|IList|IEnumerable)\s*<.*>$/;
const MAP_TYPES = /^(Dictionary|IDictionary)\s*<.*>$/;

function typeRole(type) {
  const t = type.trim();
  if (COLLECTION_TYPES.test(t) || t.endsWith("[]")) return "list";
  if (MAP_TYPES.test(t)) return "dict";
  if (t === "string") return "string";
  if (["int", "long", "double", "float", "decimal", "short"].includes(t)) return "number";
  if (t === "bool") return "boolean";
  return "variable";
}

export function buildSymbolTable(lines, symbolTable) {
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || isCommentLine(line)) return;

    const cls = line.match(/\bclass\s+([A-Za-z_]\w*)/);
    if (cls) symbolTable.add(cls[1], "class");

    const method = line.match(/^(?:public|private|protected|internal)?\s*(?:static\s+)?[\w<>\[\], ]+\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{?$/);
    if (method && !/\b(if|for|foreach|while|switch)\b/.test(line)) symbolTable.add(method[1], "function", { parameters: method[2].trim() });

    const decl = line.match(/^(?:public|private|protected|internal)?\s*(?:static\s+)?(?:readonly\s+)?([\w<>\[\], ]+?)\s+([A-Za-z_]\w*)\s*=\s*(.+);/);
    if (decl) symbolTable.add(decl[2], decl[1].trim() === "var" ? "variable" : typeRole(decl[1]));

    const forEach = line.match(/^foreach\s*\(\s*(?:var|[\w<>\[\]]+)\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)\s*\)/);
    if (forEach) {
      const info = symbolTable.get(forEach[2]);
      symbolTable.add(forEach[1], "loop-item", { of: forEach[2], ofType: info ? info.role : "collection" });
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
    if (/^using\s+[\w.]+;/.test(line)) result.imports.push(lineNumber);

    const cls = line.match(/\bclass\s+([A-Za-z_]\w*)/);
    if (cls) result.classes.push({ line: lineNumber, name: cls[1] });

    const method = line.match(/^(?:public|private|protected|internal)?\s*(?:static\s+)?[\w<>\[\], ]+\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{?$/);
    if (method && !/\b(if|for|foreach|while|switch)\b/.test(line)) result.functions.push({ line: lineNumber, name: method[1], parameters: method[2] });

    if (/^(for|while)\s*\(/.test(line) || /^foreach\s*\(/.test(line)) result.loops.push(lineNumber);
    if (/^if\s*\(/.test(line) || /^else\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^return\b/.test(line)) result.returns.push(lineNumber);
    if (/\bConsole\.(Write|WriteLine)\s*\(/.test(line)) result.outputs.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine, symbolTable) {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  if (/^using\s+[\w.]+;/.test(trimmed)) return "Imports a namespace so its classes/functions can be used without full qualification.";

  const cls = trimmed.match(/\bclass\s+([A-Za-z_]\w*)/);
  if (cls) return `Defines the class \`${cls[1]}\`, which can serve as a blueprint for creating objects.`;

  const method = trimmed.match(/^(?:public|private|protected|internal)?\s*(?:static\s+)?([\w<>\[\], ]+?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{?$/);
  if (method && !/\b(if|for|foreach|while|switch)\b/.test(trimmed)) {
    const [, returnType, name, params] = method;
    return params.trim()
      ? `Defines the method \`${name}\`, which accepts \`${params.trim()}\` and returns \`${returnType.trim()}\`.`
      : `Defines the method \`${name}\`, which returns \`${returnType.trim()}\` and takes no parameters.`;
  }

  const forEach = trimmed.match(/^foreach\s*\(\s*(?:var|[\w<>\[\]]+)\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)\s*\)/);
  if (forEach) {
    const info = symbolTable.get(forEach[2]);
    const phrase = info && info.role === "list" ? `the \`${forEach[2]}\` collection` : `\`${forEach[2]}\``;
    return `Iterates over ${phrase}; on each pass, \`${forEach[1]}\` represents the current item.`;
  }

  if (/^for\s*\(/.test(trimmed)) return "Starts a counted loop that repeats a block of code a set number of times.";
  if (/^while\s*\(/.test(trimmed)) return "Starts a while loop that keeps running while its condition stays true.";

  const ifMatch = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
  if (ifMatch) {
    const known = symbolTable.knownIdentifiersIn(ifMatch[1]);
    if (known.length === 1 && ifMatch[1].trim() === known[0]) return `Checks whether ${symbolTable.describe(known[0])} meets the condition before running the code that follows.`;
    return `Checks whether \`${ifMatch[1].trim()}\` is true before running the code that follows.`;
  }
  if (/^\}?\s*else\b/.test(trimmed)) return "Defines the alternative block that runs when the previous condition is false.";

  const ret = trimmed.match(/^return\b\s*(.*?);?$/);
  if (ret) return ret[1].trim() ? `Returns \`${ret[1].trim()}\` from the current method.` : "Returns control from the current method (void).";

  const write = trimmed.match(/Console\.(Write|WriteLine)\s*\((.*)\)\s*;?$/);
  if (write) return `Prints \`${write[2].trim()}\` to the console${write[1] === "WriteLine" ? " with a trailing newline" : ""}.`;

  const decl = trimmed.match(/^(?:public|private|protected|internal)?\s*(?:static\s+)?(?:readonly\s+)?([\w<>\[\], ]+?)\s+([A-Za-z_]\w*)\s*=\s*(.+);/);
  if (decl) return `Declares a \`${decl[1].trim()}\` variable \`${decl[2]}\` and assigns it \`${decl[3]}\`.`;

  if (["}", "};"].includes(trimmed)) return "Closes the current code block.";

  return genericFallbackExplanation();
}

export function findIssues(lines) {
  const issues = findCommonIssues(lines);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/catch\s*\(\s*Exception\s+\w+\s*\)/.test(line)) {
      issues.push({ line: index + 1, type: "warning", message: "Catches the broad `Exception` type. Catching more specific exceptions is usually safer." });
    }
  });

  return issues;
}
