import * as js from "./javascript.js";
import { isCommentLine, commentExplanation, genericFallbackExplanation, explainTernary } from "../shared/patterns.js";

export const id = "typescript";
export const label = "TypeScript";

// Reuse JavaScript's brace-based scoping — same block structure.
export const scopeStyle = "brace";
export const functionStartRegex = js.functionStartRegex;

export function detect(code) {
  return (
    /\b(interface|type)\s+\w+/.test(code) ||
    /:\s*(string|number|boolean|any|void|unknown)\b/.test(code)
  );
}

export function buildSymbolTable(lines, symbolTable, lineScopes = []) {
  js.buildSymbolTable(lines, symbolTable, lineScopes);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || isCommentLine(line)) return;

    const scope = lineScopes[index] || "global";

    const iface = line.match(/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/);
    if (iface) symbolTable.add(iface[1], "class", { kind: "interface" }, scope);

    const typeAlias = line.match(/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/);
    if (typeAlias) symbolTable.add(typeAlias[1], "class", { kind: "type alias" }, scope);

    // typed declaration: const x: number = 5;
    const typed = line.match(/^(?:export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*([\w<>\[\]| ]+?)\s*=/);
    if (typed) {
      const tsType = typed[3].trim();
      const roleMap = { string: "string", number: "number", boolean: "boolean" };
      const role = roleMap[tsType] || (tsType.endsWith("[]") ? "list" : "variable");
      symbolTable.add(typed[2], role, { tsType }, scope);
    }
  });

  return symbolTable;
}

export function analyzeStructure(lines) {
  const structure = js.analyzeStructure(lines);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/.test(line) || /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/.test(line)) {
      structure.classes.push({ line: index + 1, name: line.split(/\s+/)[line.startsWith("export") ? 2 : 1] });
    }
  });
  return structure;
}

export function explainLine(rawLine, symbolTable, scope = "global") {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (isCommentLine(trimmed)) return commentExplanation();

  const iface = trimmed.match(/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/);
  if (iface) return `Defines the \`${iface[1]}\` interface, describing the shape an object of this type must have.`;

  const typeAlias = trimmed.match(/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);?$/);
  if (typeAlias) return `Defines a type alias \`${typeAlias[1]}\` equal to \`${typeAlias[2]}\`.`;

  const typed = trimmed.match(/^(?:export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*([\w<>\[\]| ]+?)\s*=\s*(.+?);?$/);
  if (typed) {
    const [, keyword, name, tsType, value] = typed;
    const ternary = explainTernary(name, value);
    if (ternary) return ternary;
    return `Declares the \`${keyword}\` variable \`${name}\` with type \`${tsType.trim()}\` and assigns it \`${value}\`.`;
  }

  const result = js.explainLine(rawLine, symbolTable, scope);
  return result || genericFallbackExplanation();
}

export function findIssues(lines, symbolTable) {
  const issues = js.findIssues(lines, symbolTable);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/:\s*any\b/.test(line)) {
      issues.push({
        line: index + 1, type: "review",
        message: "Uses the `any` type, which turns off type checking for this value. A more specific type is usually safer.",
      });
    }
  });

  return issues;
}
