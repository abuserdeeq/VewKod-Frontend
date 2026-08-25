// Replace with your deployed Render backend URL
const API_BASE_URL = "https://vewkod.onrender.com";

/**
 * Fallback local explanation generator
 * Used when backend is unavailable
 */
// ============================================================
// LOCAL EXPLANATION ENGINE V2
// Rule-based fallback — runs entirely in the browser
// ============================================================

function detectLanguage(code, selectedLanguage = "auto") {
  if (selectedLanguage && selectedLanguage !== "auto") {
    return selectedLanguage;
  }

  const text = code.trim();

  if (/<(!DOCTYPE html|html|head|body)\b/i.test(text)) {
    return "html";
  }

  if (/<[a-z][\s\S]*>/i.test(text) && /<\/[a-z]+>/i.test(text)) {
    return "html";
  }

  if (/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE)\b/i.test(text)) {
    return "sql";
  }

  if (
    /\b(def|elif|print)\b/.test(text) ||
    /:\s*(#.*)?$/.test(text) && !/[{};]/.test(text)
  ) {
    return "python";
  }

  if (
    /\b(const|let|var|console\.log|=>|function)\b/.test(text) ||
    /\b(import|export)\b.*\b(from|default)\b/.test(text)
  ) {
    return "javascript";
  }

  if (
    /\b(interface|type)\s+\w+/.test(text) ||
    /:\s*(string|number|boolean)\b/.test(text)
  ) {
    return "typescript";
  }

  if (
    /\b(public|private|protected)\b/.test(text) &&
    /\b(class|static|void|int|String)\b/.test(text)
  ) {
    return "java";
  }

  if (
    /#include\s*<.*>/.test(text) ||
    /\b(std::|cout|cin|vector<|namespace)\b/.test(text)
  ) {
    return "cpp";
  }

  if (
    /\bprintf\s*\(/.test(text) ||
    /#include\s*<stdio\.h>/.test(text)
  ) {
    return "c";
  }

  if (
    /[.#][\w-]+\s*\{[^}]*\}/s.test(text) ||
    /@(media|keyframes|import)\b/.test(text)
  ) {
    return "css";
  }

  return "unknown";
}


// ------------------------------------------------------------
// Structure analysis
// ------------------------------------------------------------

function analyzeStructure(code, language) {
  const lines = code.split("\n");

  const result = {
    functions: [],
    classes: [],
    imports: [],
    variables: [],
    loops: [],
    conditionals: [],
    returns: [],
    outputs: [],
    comments: [],
  };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!line) return;

    // Comments
    if (
      line.startsWith("//") ||
      line.startsWith("#") ||
      line.startsWith("/*") ||
      line.startsWith("*")
    ) {
      result.comments.push(lineNumber);
    }

    // Python functions
    const pythonFunction = line.match(
      /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/
    );

    // JavaScript / TypeScript functions
    const jsFunction = line.match(
      /^(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/
    );

    // Arrow functions
    const arrowFunction = line.match(
      /^(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/
    );

    if (pythonFunction) {
      result.functions.push({
        line: lineNumber,
        name: pythonFunction[1],
        parameters: pythonFunction[2],
      });
    } else if (jsFunction) {
      result.functions.push({
        line: lineNumber,
        name: jsFunction[1],
        parameters: jsFunction[2],
      });
    } else if (arrowFunction) {
      result.functions.push({
        line: lineNumber,
        name: arrowFunction[1],
        parameters: arrowFunction[2],
      });
    }

    // Classes
    const classMatch = line.match(
      /\bclass\s+([A-Za-z_]\w*)/
    );

    if (classMatch) {
      result.classes.push({
        line: lineNumber,
        name: classMatch[1],
      });
    }

    // Imports
    if (
      /^(import|from)\b/.test(line) ||
      /^#include\b/.test(line) ||
      /\brequire\s*\(/.test(line)
    ) {
      result.imports.push(lineNumber);
    }

    // Variables
    const variableMatch = line.match(
      /^(?:const|let|var)\s+([A-Za-z_]\w*)\s*=/
    );

    const pythonVariableMatch = line.match(
      /^([A-Za-z_]\w*)\s*=\s*(?!=)/
    );

    if (variableMatch) {
      result.variables.push({
        line: lineNumber,
        name: variableMatch[1],
      });
    } else if (
      language === "python" &&
      pythonVariableMatch &&
      !/^if\b|^for\b|^while\b|^def\b/.test(line)
    ) {
      result.variables.push({
        line: lineNumber,
        name: pythonVariableMatch[1],
      });
    }

    // Loops
    if (
      /^(for|while)\b/.test(line) ||
      /\bfor\s*\(/.test(line) ||
      /\bforEach\s*\(/.test(line)
    ) {
      result.loops.push(lineNumber);
    }

    // Conditions
    if (
      /^(if|elif|else|switch|case)\b/.test(line) ||
      /\bif\s*\(/.test(line)
    ) {
      result.conditionals.push(lineNumber);
    }

    // Return
    if (/^return\b/.test(line)) {
      result.returns.push(lineNumber);
    }

    // Output
    if (
      /\bprint\s*\(/.test(line) ||
      /\bconsole\.log\s*\(/.test(line) ||
      /\bprintf\s*\(/.test(line) ||
      /\bcout\s*<</.test(line)
    ) {
      result.outputs.push(lineNumber);
    }
  });

  return result;
}


// ------------------------------------------------------------
// Human-readable line explanation
// ------------------------------------------------------------

function explainLine(line, language) {
  const trimmed = line.trim();

  if (!trimmed) {
    return null;
  }

  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*")
  ) {
    return "Comment — this line provides information for developers and is not normally executed.";
  }

  if (/^import\b|^from\b|^#include\b/.test(trimmed)) {
    return "Imports a library, module, or dependency so its functionality can be used by the program.";
  }

  if (/^def\s+\w+\s*\(/.test(trimmed)) {
    const match = trimmed.match(/^def\s+(\w+)\s*\(([^)]*)\)/);

    if (match) {
      const params = match[2].trim();

      return params
        ? `Defines the function \`${match[1]}\`, which accepts ${params} as input parameter(s).`
        : `Defines the function \`${match[1]}\`.`;
    }
  }

  if (/^(async\s+)?function\s+\w+\s*\(/.test(trimmed)) {
    const match = trimmed.match(
      /^(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/
    );

    if (match) {
      return `Defines the function \`${match[1]}\`, which can be reused to perform a specific task.`;
    }
  }

  if (/^(for|while)\b/.test(trimmed) || /\bfor\s*\(/.test(trimmed)) {
    return "Starts a loop that repeatedly executes code while its iteration condition is satisfied.";
  }

  if (/^if\b/.test(trimmed) || /\bif\s*\(/.test(trimmed)) {
    return "Checks a condition and executes the related code when that condition is true.";
  }

  if (/^(elif|else if)\b/.test(trimmed)) {
    return "Checks an alternative condition when the previous condition was not satisfied.";
  }

  if (/^else\b/.test(trimmed)) {
    return "Defines the alternative block that runs when the preceding condition is false.";
  }

  if (/^return\b/.test(trimmed)) {
    const value = trimmed.replace(/^return\s+/, "").replace(/;$/, "");

    return value
      ? `Returns \`${value}\` from the current function.`
      : "Returns control from the current function.";
  }

  if (
    /\bprint\s*\(/.test(trimmed) ||
    /\bconsole\.log\s*\(/.test(trimmed) ||
    /\bprintf\s*\(/.test(trimmed)
  ) {
    return "Outputs information to the console or standard output.";
  }

  const assignment = trimmed.match(
    /^(?:const|let|var)?\s*([A-Za-z_]\w*)\s*=\s*(.+?);?$/
  );

  if (assignment) {
    const variable = assignment[1];
    const value = assignment[2];

    return `Assigns \`${value}\` to the variable \`${variable}\`.`;
  }

  if (/^class\s+\w+/.test(trimmed)) {
    const match = trimmed.match(/^class\s+(\w+)/);

    return match
      ? `Defines the class \`${match[1]}\`, which can be used as a blueprint for creating objects.`
      : "Defines a class.";
  }

  return "Executes a statement or operation as part of the program's flow.";
}


// ------------------------------------------------------------
// Local Explanation Engine V2
// ------------------------------------------------------------

function generateLocalExplanation(code, language, difficulty) {
  const detectedLanguage = detectLanguage(code, language);
  const structure = analyzeStructure(code, detectedLanguage);

  // IMPORTANT:
  // Keep original lines so line numbers remain accurate.
  const lines = code.split("\n");

  let explanation = `## Overview\n\n`;

  explanation += `This is a **${detectedLanguage}** code snippet containing **${lines.length} line${lines.length !== 1 ? "s" : ""}**. `;

  if (structure.functions.length) {
    explanation += `It contains **${structure.functions.length} function${structure.functions.length !== 1 ? "s" : ""}**. `;
  }

  if (structure.classes.length) {
    explanation += `It defines **${structure.classes.length} class${structure.classes.length !== 1 ? "es" : ""}**. `;
  }

  if (structure.loops.length) {
    explanation += `It uses loop-based repetition. `;
  }

  if (structure.conditionals.length) {
    explanation += `It contains conditional logic. `;
  }

  explanation += `\n\n`;

  // Structure
  explanation += `## Structure Breakdown\n\n`;

  if (structure.imports.length) {
    explanation += `### Imports\n`;
    explanation += `The code imports or includes external functionality.\n\n`;
  }

  if (structure.functions.length) {
    explanation += `### Functions\n`;

    structure.functions.forEach((fn) => {
      explanation += `- **Line ${fn.line}:** \`${fn.name}()\``;

      if (fn.parameters.trim()) {
        explanation += ` accepts \`${fn.parameters.trim()}\`.`;
      } else {
        explanation += ` does not define any parameters.`;
      }

      explanation += `\n`;
    });

    explanation += `\n`;
  }

  if (structure.classes.length) {
    explanation += `### Classes\n`;

    structure.classes.forEach((item) => {
      explanation += `- **Line ${item.line}:** Defines class \`${item.name}\`.\n`;
    });

    explanation += `\n`;
  }

  if (structure.variables.length) {
    explanation += `### Variables\n`;

    structure.variables.slice(0, 10).forEach((item) => {
      explanation += `- **Line ${item.line}:** Uses variable \`${item.name}\`.\n`;
    });

    if (structure.variables.length > 10) {
      explanation += `- ...and ${structure.variables.length - 10} more variable(s).\n`;
    }

    explanation += `\n`;
  }

  if (structure.loops.length) {
    explanation += `### Loops\n`;

    structure.loops.forEach((line) => {
      explanation += `- **Line ${line}:** A loop begins here.\n`;
    });

    explanation += `\n`;
  }

  if (structure.conditionals.length) {
    explanation += `### Conditional Logic\n`;

    structure.conditionals.forEach((line) => {
      explanation += `- **Line ${line}:** Conditional logic is used here.\n`;
    });

    explanation += `\n`;
  }

  if (structure.outputs.length) {
    explanation += `### Output\n`;
    explanation += `The code contains output statements that display information.\n\n`;
  }

  // Line-by-line
  if (difficulty !== "advanced") {
    explanation += `## Line-by-Line Explanation\n\n`;

    const maxLines = 20;

    lines.slice(0, maxLines).forEach((line, index) => {
      const description = explainLine(line, detectedLanguage);

      if (description) {
        explanation += `- **Line ${index + 1}:** ${description}\n`;
      }
    });

    if (lines.length > maxLines) {
      explanation += `- ...and ${lines.length - maxLines} more line(s).\n`;
    }

    explanation += `\n`;
  }

  // Key concepts
  explanation += `## Key Concepts\n\n`;

  if (structure.functions.length) {
    explanation += `- **Functions:** Reusable blocks of code that perform specific tasks.\n`;
  }

  if (structure.loops.length) {
    explanation += `- **Loops:** Used to repeat operations.\n`;
  }

  if (structure.conditionals.length) {
    explanation += `- **Conditions:** Used to make decisions based on logical expressions.\n`;
  }

  if (structure.variables.length) {
    explanation += `- **Variables:** Used to store and work with data.\n`;
  }

  if (!structure.functions.length &&
      !structure.loops.length &&
      !structure.conditionals.length &&
      !structure.variables.length) {
    explanation += `- The snippet contains basic executable statements.\n`;
  }

  explanation += `\n---\n\n`;
  explanation += `*Generated by VewKod Local Explanation Engine V2. This fallback runs locally when the AI backend is unavailable.*`;

  return explanation;
}

export async function explainCode(code, difficulty, language = "auto") {
  // Try backend first
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(`${API_BASE_URL}/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, difficulty, language }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    return { explanation: data.explanation, source: "ai" };
  } catch (err) {
    console.warn("Backend unavailable, using local explanation:", err.message);
    // Fallback to local explanation
    const explanation = generateLocalExplanation(code, language, difficulty);
    return { explanation, source: "local" };
  }
}
