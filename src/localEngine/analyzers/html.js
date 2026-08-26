import { genericFallbackExplanation } from "../shared/patterns.js";

export const id = "html";
export const label = "HTML";

export function detect(code) {
  const text = code.trim();
  return /<(!DOCTYPE html|html|head|body)\b/i.test(text) || (/<[a-z][\s\S]*>/i.test(text) && /<\/[a-z]+>/i.test(text));
}

// HTML has no "variables" in the usual sense, but we track ids/classes
// so repeated references can be described consistently.
export function buildSymbolTable(lines, symbolTable) {
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    const idMatch = line.match(/\bid=["']([\w-]+)["']/);
    if (idMatch) symbolTable.add(idMatch[1], "class", { kind: "element id" });
  });
  return symbolTable;
}

export function analyzeStructure(lines) {
  const result = { functions: [], classes: [], imports: [], variables: [], loops: [], conditionals: [], returns: [], outputs: [], comments: [] };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;
    if (line.startsWith("<!--")) result.comments.push(lineNumber);

    const tag = line.match(/^<([A-Za-z][\w-]*)\b/);
    if (tag) result.variables.push({ line: lineNumber, name: `<${tag[1]}>` });

    if (/<script\b/i.test(line)) result.functions.push({ line: lineNumber, name: "<script>", parameters: "" });
  });

  return result;
}

export function explainLine(rawLine) {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("<!--")) return "This is an HTML comment. It provides information for developers and is not rendered.";

  if (/^<!DOCTYPE html>/i.test(trimmed)) return "Declares this document as HTML5, telling the browser how to parse it.";

  const attrTag = trimmed.match(/^<([A-Za-z][\w-]*)\b([^>]*)>?/);
  if (attrTag) {
    const [, tagName, attrs] = attrTag;
    const idMatch = attrs.match(/\bid=["']([\w-]+)["']/);
    const classMatch = attrs.match(/\bclass=["']([\w -]+)["']/);
    let detail = "";
    if (idMatch) detail += ` with id \`${idMatch[1]}\``;
    if (classMatch) detail += `${idMatch ? " and" : " with"} class \`${classMatch[1]}\``;
    return `Creates/starts the \`<${tagName}>\` element${detail}.`;
  }

  if (/^<\/[A-Za-z]/.test(trimmed)) {
    const close = trimmed.match(/^<\/([A-Za-z][\w-]*)/);
    return `Closes the \`<${close[1]}>\` element.`;
  }

  return genericFallbackExplanation();
}

export function findIssues(lines) {
  const issues = [];
  let hasImgWithoutAlt = false;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();

    if (/^<img\b/i.test(line) && !/\balt=/i.test(line)) {
      hasImgWithoutAlt = true;
      issues.push({ line: index + 1, type: "warning", message: "This `<img>` tag has no `alt` attribute, which hurts accessibility and SEO." });
    }

    if (/<[a-z]+[^>]*\bonclick=/i.test(line)) {
      issues.push({ line: index + 1, type: "review", message: "Uses an inline `onclick` handler. Attaching event listeners in JavaScript is usually easier to maintain." });
    }

    if (/<a\b[^>]*>/i.test(line) && !/\bhref=/i.test(line)) {
      issues.push({ line: index + 1, type: "review", message: "This `<a>` tag has no `href` attribute." });
    }
  });

  return issues;
}
