import { createSymbolTable } from "./symbolTable.js";
import { computeLineScopes } from "../shared/patterns.js";

import * as python from "../analyzers/python.js";
import * as javascript from "../analyzers/javascript.js";
import * as typescript from "../analyzers/typescript.js";
import * as java from "../analyzers/java.js";
import * as c from "../analyzers/c.js";
import * as cpp from "../analyzers/cpp.js";
import * as html from "../analyzers/html.js";
import * as css from "../analyzers/css.js";
import * as sql from "../analyzers/sql.js";
import * as csharp from "../analyzers/csharp.js";
import * as go from "../analyzers/go.js";
import * as rust from "../analyzers/rust.js";
import * as php from "../analyzers/php.js";
import * as ruby from "../analyzers/ruby.js";
import * as swift from "../analyzers/swift.js";
import * as kotlin from "../analyzers/kotlin.js";
import * as bash from "../analyzers/bash.js";

// Order matters: more specific/distinctive detectors should run
// before more general ones (e.g. TypeScript before JavaScript,
// HTML before others, php's `<?php` tag before bash's `$var`+echo).
const ANALYZERS = [
  html, css, sql, bash, typescript, python, csharp, java, cpp, c,
  go, rust, php, ruby, swift, kotlin, javascript,
];

const REGISTRY = ANALYZERS.reduce((acc, analyzer) => {
  acc[analyzer.id] = analyzer;
  return acc;
}, {});

export function detectLanguage(code, selectedLanguage = "auto") {
  if (selectedLanguage && selectedLanguage !== "auto" && REGISTRY[selectedLanguage]) {
    return selectedLanguage;
  }

  for (const analyzer of ANALYZERS) {
    if (analyzer.detect(code)) return analyzer.id;
  }

  return "unknown";
}

// Minimal fallback used only when nothing matches — keeps the
// engine from crashing on an unrecognized/empty snippet.
const genericAnalyzer = {
  id: "unknown",
  label: "Unknown",
  buildSymbolTable: (lines, symbolTable) => symbolTable,
  analyzeStructure: () => ({ functions: [], classes: [], imports: [], variables: [], loops: [], conditionals: [], returns: [], outputs: [], comments: [] }),
  explainLine: (rawLine) => (rawLine.trim() ? "Executes a statement or operation that contributes to the program's overall logic." : null),
  findIssues: () => [],
};

function getAnalyzer(languageId) {
  return REGISTRY[languageId] || genericAnalyzer;
}

function buildOverview(detectedLanguage, label, lines, structure) {
  let text = `## Overview\n\n`;
  text += `This is a **${label}** code snippet containing **${lines.length} line${lines.length !== 1 ? "s" : ""}**. `;

  if (structure.functions.length) text += `It contains **${structure.functions.length} function${structure.functions.length !== 1 ? "s" : ""}**. `;
  if (structure.classes.length) text += `It defines **${structure.classes.length} class${structure.classes.length !== 1 ? "es" : ""}**. `;
  if (structure.loops.length) text += `It uses loop-based repetition. `;
  if (structure.conditionals.length) text += `It contains conditional logic. `;

  text += `\n\n`;
  return text;
}

function buildStructureBreakdown(structure) {
  let text = `## Structure Breakdown\n\n`;

  if (structure.imports.length) {
    text += `### Imports\nThe code imports or includes external functionality.\n\n`;
  }

  if (structure.functions.length) {
    text += `### Functions\n`;
    structure.functions.forEach((fn) => {
      text += `- **Line ${fn.line}:** \`${fn.name}()\``;
      text += fn.parameters && fn.parameters.trim() ? ` accepts \`${fn.parameters.trim()}\`.\n` : ` does not define any parameters.\n`;
    });
    text += `\n`;
  }

  if (structure.classes.length) {
    text += `### Classes\n`;
    structure.classes.forEach((item) => { text += `- **Line ${item.line}:** Defines \`${item.name}\`.\n`; });
    text += `\n`;
  }

  if (structure.variables.length) {
    text += `### Variables\n`;
    structure.variables.slice(0, 10).forEach((item) => { text += `- **Line ${item.line}:** Uses \`${item.name}\`.\n`; });
    if (structure.variables.length > 10) text += `- ...and ${structure.variables.length - 10} more.\n`;
    text += `\n`;
  }

  if (structure.loops.length) {
    text += `### Loops\n`;
    structure.loops.forEach((line) => { text += `- **Line ${line}:** A loop begins here.\n`; });
    text += `\n`;
  }

  if (structure.conditionals.length) {
    text += `### Conditional Logic\n`;
    structure.conditionals.forEach((line) => { text += `- **Line ${line}:** Conditional logic is used here.\n`; });
    text += `\n`;
  }

  if (structure.outputs.length) {
    text += `### Output\nThe code contains output statements that display information.\n\n`;
  }

  return text;
}

function buildKeyConcepts(structure) {
  let text = `## Key Concepts\n\n`;
  if (structure.functions.length) text += `- **Functions:** Reusable blocks of code that perform specific tasks.\n`;
  if (structure.loops.length) text += `- **Loops:** Used to repeat operations.\n`;
  if (structure.conditionals.length) text += `- **Conditions:** Used to make decisions based on logical expressions.\n`;
  if (structure.variables.length) text += `- **Variables:** Used to store and work with data.\n`;

  if (!structure.functions.length && !structure.loops.length && !structure.conditionals.length && !structure.variables.length) {
    text += `- The snippet contains basic executable statements.\n`;
  }

  return text;
}

function buildIssuesSection(issues) {
  let text = `## Potential Issues\n\n`;

  if (!issues.length) {
    return text + `No obvious issues were detected by the local rule-based analyzer.\n\n`;
  }

  issues.slice(0, 10).forEach((issue) => {
    const icon = issue.type === "security" ? "🔐" : issue.type === "warning" ? "⚠️" : "💡";
    text += `- ${icon} **Line ${issue.line}:** ${issue.message}\n`;
  });

  if (issues.length > 10) text += `- ...and ${issues.length - 10} more potential issue(s).\n`;
  text += `\n`;
  return text;
}

function buildRemainderSummary(lines, maxLines, structure) {
  const remainingCount = lines.length - maxLines;
  let text = `- *(${remainingCount} more line${remainingCount !== 1 ? "s" : ""} not shown individually — summary below)*\n`;

  const remainderFns = structure.functions.filter((f) => f.line > maxLines);
  const remainderLoops = structure.loops.filter((l) => l > maxLines);
  const remainderConds = structure.conditionals.filter((l) => l > maxLines);
  const remainderClasses = structure.classes.filter((c) => c.line > maxLines);

  if (remainderFns.length) text += `  - Defines ${remainderFns.length} more function(s): ${remainderFns.map((f) => `\`${f.name}\` (line ${f.line})`).join(", ")}\n`;
  if (remainderClasses.length) text += `  - Defines ${remainderClasses.length} more class(es): ${remainderClasses.map((c) => `\`${c.name}\` (line ${c.line})`).join(", ")}\n`;
  if (remainderLoops.length) text += `  - Contains ${remainderLoops.length} more loop(s) (starting at line${remainderLoops.length !== 1 ? "s" : ""} ${remainderLoops.join(", ")}).\n`;
  if (remainderConds.length) text += `  - Contains ${remainderConds.length} more conditional block(s) (starting at line${remainderConds.length !== 1 ? "s" : ""} ${remainderConds.join(", ")}).\n`;

  return text;
}

export function generateLocalExplanation(code, language) {
  const detectedLanguage = detectLanguage(code, language);
  const analyzer = getAnalyzer(detectedLanguage);
  const lines = code.split("\n");

  // Function-level scoping: lets two different functions reuse the
  // same variable name without one clobbering the other's meaning.
  // Only analyzers that declare `scopeStyle`/`functionStartRegex`
  // opt in — others fall back to a single flat "global" scope,
  // identical to the previous (pre-scoping) behavior.
  const lineScopes = computeLineScopes(lines, analyzer.scopeStyle || "none", analyzer.functionStartRegex || null);

  const symbolTable = createSymbolTable();
  analyzer.buildSymbolTable(lines, symbolTable, lineScopes);

  const structure = analyzer.analyzeStructure(lines, symbolTable);
  const issues = analyzer.findIssues(lines, symbolTable);

  let explanation = buildOverview(detectedLanguage, analyzer.label || detectedLanguage, lines, structure);
  explanation += buildStructureBreakdown(structure);

  explanation += `## Line-by-Line Explanation\n\n`;
  const maxLines = 40;

  lines.slice(0, maxLines).forEach((line, index) => {
    const description = analyzer.explainLine(line, symbolTable, lineScopes[index]);
    if (description) explanation += `- **Line ${index + 1}:** ${description}\n`;
  });

  if (lines.length > maxLines) {
    explanation += buildRemainderSummary(lines, maxLines, structure);
  }
  explanation += `\n`;

  explanation += buildKeyConcepts(structure);
  explanation += buildIssuesSection(issues);

  explanation += `\n---\n\n`;
  explanation += `*Generated by VewKod Local Explanation Engine V3 (language-specific analyzers). This fallback runs locally when the AI backend is unavailable.*`;

  return explanation;
}
