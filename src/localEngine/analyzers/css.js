import { genericFallbackExplanation } from "../shared/patterns.js";

export const id = "css";
export const label = "CSS";

export function detect(code) {
  return /[.#][\w-]+\s*\{[^}]*\}/s.test(code) || /@(media|keyframes|import)\b/.test(code);
}

export function buildSymbolTable(lines, symbolTable) {
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    const selector = line.match(/^([.#]?[\w-]+)\s*\{/);
    if (selector) symbolTable.add(selector[1], "class", { kind: "selector" });
  });
  return symbolTable;
}

export function analyzeStructure(lines) {
  const result = { functions: [], classes: [], imports: [], variables: [], loops: [], conditionals: [], returns: [], outputs: [], comments: [] };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;
    if (line.startsWith("/*") || line.startsWith("*")) result.comments.push(lineNumber);
    if (/^@import\b/.test(line)) result.imports.push(lineNumber);

    const selector = line.match(/^([.#]?[\w-]+)\s*\{/);
    if (selector) result.classes.push({ line: lineNumber, name: selector[1] });

    if (/^@media\b/.test(line)) result.conditionals.push(lineNumber);
    if (/^@keyframes\b/.test(line)) result.loops.push(lineNumber);
  });

  return result;
}

export function explainLine(rawLine) {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/*") || trimmed.startsWith("*")) return "This is a CSS comment. It provides information for developers and has no visual effect.";

  if (/^@import\b/.test(trimmed)) return "Imports another stylesheet's rules into this one.";
  if (/^@media\b/.test(trimmed)) return "Starts a media query — the rules inside only apply when the given screen condition is met (e.g. a max width).";
  if (/^@keyframes\b/.test(trimmed)) return "Starts a keyframes block, defining the stages of a CSS animation.";

  const selector = trimmed.match(/^([.#]?[\w-]+(?:[\s>+~][.#]?[\w-]+)*)\s*\{/);
  if (selector) {
    const sel = selector[1];
    const kind = sel.startsWith(".") ? "class" : sel.startsWith("#") ? "id" : "element";
    return `Starts a rule that styles every ${kind} matching \`${sel}\`.`;
  }

  const property = trimmed.match(/^([\w-]+)\s*:\s*(.+?);?$/);
  if (property) return `Sets the \`${property[1]}\` property to \`${property[2].replace(/;$/, "")}\`.`;

  if (trimmed === "}") return "Closes the current CSS rule.";

  return genericFallbackExplanation();
}

export function findIssues(lines) {
  const issues = [];

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/!important/i.test(line)) {
      issues.push({ line: index + 1, type: "review", message: "Uses `!important`, which overrides normal cascade rules and can make future styling harder to maintain." });
    }
    if (/^\*\s*\{/.test(line)) {
      issues.push({ line: index + 1, type: "review", message: "The universal selector `*` applies to every element, which can be expensive to repaint/reflow at scale." });
    }
  });

  return issues;
}
