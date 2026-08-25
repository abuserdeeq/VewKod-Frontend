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

  if (!trimmed) return null;

  // ----------------------------------------------------------
  // Comments
  // ----------------------------------------------------------

  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("<!--")
  ) {
    return "This is a comment. It provides information for developers and is not normally executed.";
  }

  // ----------------------------------------------------------
  // Imports
  // ----------------------------------------------------------

  if (
    /^import\s+/.test(trimmed) ||
    /^from\s+.+\s+import\s+/.test(trimmed) ||
    /^#include\s*</.test(trimmed) ||
    /^require\s*\(/.test(trimmed)
  ) {
    return "Imports a library, module, or dependency so functionality from another part of the project can be used.";
  }

  // ----------------------------------------------------------
  // Python function
  // ----------------------------------------------------------

  const pythonFunction = trimmed.match(
    /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/
  );

  if (pythonFunction) {
    const name = pythonFunction[1];
    const params = pythonFunction[2].trim();

    return params
      ? `Defines the Python function \`${name}\`, which accepts \`${params}\` as parameter(s).`
      : `Defines the Python function \`${name}\` without parameters.`;
  }

  // ----------------------------------------------------------
  // JavaScript / TypeScript function
  // ----------------------------------------------------------

  const jsFunction = trimmed.match(
    /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/
  );

  if (jsFunction) {
    const name = jsFunction[1];
    const params = jsFunction[2].trim();

    return params
      ? `Defines the function \`${name}\`, which accepts \`${params}\` as parameter(s).`
      : `Defines the function \`${name}\` without parameters.`;
  }

  // ----------------------------------------------------------
  // Arrow function
  // ----------------------------------------------------------

  const arrowFunction = trimmed.match(
    /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/
  );

  if (arrowFunction) {
    const name = arrowFunction[1];
    const params = arrowFunction[2] ?? arrowFunction[3] ?? "";

    return params.trim()
      ? `Defines the arrow function \`${name}\`, which accepts \`${params.trim()}\` as parameter(s).`
      : `Defines the arrow function \`${name}\`.`;
  }

  // ----------------------------------------------------------
  // Class
  // ----------------------------------------------------------

  const classMatch = trimmed.match(
    /^class\s+([A-Za-z_$][\w$]*)/
  );

  if (classMatch) {
    return `Defines the class \`${classMatch[1]}\`, which can serve as a blueprint for creating objects.`;
  }

  // ----------------------------------------------------------
  // For loops
  // ----------------------------------------------------------

  if (
    /^for\s*\(/.test(trimmed) ||
    /^for\s+\w+\s+in\s+/.test(trimmed) ||
    /\bforEach\s*\(/.test(trimmed)
  ) {
    return "Starts a loop that repeatedly processes items or executes code for multiple iterations.";
  }

  // ----------------------------------------------------------
  // While loops
  // ----------------------------------------------------------

  if (
    /^while\s*\(/.test(trimmed) ||
    /^while\s+True\s*:/.test(trimmed) ||
    /^while\s+true\s*\{?/.test(trimmed)
  ) {
    return "Starts a while loop that continues executing while its condition remains true.";
  }

  // ----------------------------------------------------------
  // If condition
  // ----------------------------------------------------------

  if (
    /^if\s*\(/.test(trimmed) ||
    /^if\s+.+:/.test(trimmed)
  ) {
    const condition = trimmed
      .replace(/^if\s*/, "")
      .replace(/^\(/, "")
      .replace(/\)\s*\{?$/, "")
      .replace(/:\s*$/, "");

    return condition
      ? `Checks whether the condition \`${condition}\` is true before executing the related code.`
      : "Checks a condition before executing the related code.";
  }

  // ----------------------------------------------------------
  // Else if / elif
  // ----------------------------------------------------------

  if (
    /^else\s+if\s*\(/.test(trimmed) ||
    /^elif\s+/.test(trimmed)
  ) {
    return "Checks another condition when the previous condition was not satisfied.";
  }

  // ----------------------------------------------------------
  // Else
  // ----------------------------------------------------------

  if (/^else\b/.test(trimmed)) {
    return "Defines the alternative block that runs when the previous condition is false.";
  }

  // ----------------------------------------------------------
  // Switch / case
  // ----------------------------------------------------------

  if (/^switch\s*\(/.test(trimmed)) {
    return "Starts a switch statement that selects a block of code based on a value.";
  }

  if (/^case\s+/.test(trimmed)) {
    return "Defines one possible case inside a switch statement.";
  }

  // ----------------------------------------------------------
  // Return
  // ----------------------------------------------------------

  if (/^return\b/.test(trimmed)) {
    const value = trimmed
      .replace(/^return\s*/, "")
      .replace(/;$/, "")
      .trim();

    return value
      ? `Returns the value \`${value}\` from the current function.`
      : "Returns control from the current function without a value.";
  }

  // ----------------------------------------------------------
  // Print / console output
  // ----------------------------------------------------------

  if (/\bconsole\.log\s*\(/.test(trimmed)) {
    const match = trimmed.match(/console\.log\s*\((.*)\)/);

    return match
      ? `Displays \`${match[1]}\` in the browser console.`
      : "Displays information in the browser console.";
  }

  if (/\bprint\s*\(/.test(trimmed)) {
    const match = trimmed.match(/print\s*\((.*)\)/);

    return match
      ? `Displays \`${match[1]}\` as program output.`
      : "Displays information as program output.";
  }

  if (/\bprintf\s*\(/.test(trimmed)) {
    return "Formats and displays output to the standard output stream.";
  }

  if (/\bcout\s*<</.test(trimmed)) {
    return "Sends output to the standard output stream.";
  }

  // ----------------------------------------------------------
  // Variable declarations
  // ----------------------------------------------------------

  const declaredVariable = trimmed.match(
    /^(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);?$/
  );

  if (declaredVariable) {
    const keyword = declaredVariable[1];
    const name = declaredVariable[2];
    const value = declaredVariable[3].replace(/;$/, "").trim();

    return `Declares the ${keyword} variable \`${name}\` and assigns it the value \`${value}\`.`;
  }

  // ----------------------------------------------------------
  // Python variable assignment
  // ----------------------------------------------------------

  const pythonVariable = trimmed.match(
    /^([A-Za-z_]\w*)\s*=\s*(.+)$/
  );

  if (
    language === "python" &&
    pythonVariable &&
    !/^(if|elif|while|for|return)\b/.test(trimmed)
  ) {
    const name = pythonVariable[1];
    const value = pythonVariable[2].trim();

    return `Assigns \`${value}\` to the Python variable \`${name}\`.`;
  }

  // ----------------------------------------------------------
  // Arithmetic assignment
  // ----------------------------------------------------------

  const arithmetic = trimmed.match(
    /^([A-Za-z_$][\w$]*)\s*=\s*(.+)\s*([+\-*/%])\s*(.+);?$/
  );

  if (arithmetic) {
    const variable = arithmetic[1];
    const left = arithmetic[2].trim();
    const operator = arithmetic[3];
    const right = arithmetic[4].replace(/;$/, "").trim();

    const operations = {
      "+": "adds",
      "-": "subtracts",
      "*": "multiplies",
      "/": "divides",
      "%": "calculates the remainder of"
    };

    return `Calculates the result by ${operations[operator]} \`${left}\` and \`${right}\`, then stores it in \`${variable}\`.`;
  }

  // ----------------------------------------------------------
  // Array declaration
  // ----------------------------------------------------------

  const arrayMatch = trimmed.match(
    /^(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*\[(.*)\]/
  );

  if (arrayMatch) {
    const name = arrayMatch[1];
    const values = arrayMatch[2].trim();

    return values
      ? `Creates an array named \`${name}\` containing the specified values.`
      : `Creates an empty array named \`${name}\`.`;
  }

  // ----------------------------------------------------------
  // Object declaration
  // ----------------------------------------------------------

  const objectMatch = trimmed.match(
    /^(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*\{/
  );

  if (objectMatch) {
    return `Creates an object named \`${objectMatch[1]}\` containing properties and values.`;
  }

  // ----------------------------------------------------------
  // Function call
  // ----------------------------------------------------------

  const functionCall = trimmed.match(
    /^([A-Za-z_$][\w$]*)\s*\((.*)\)\s*;?$/
  );

  if (functionCall) {
    const name = functionCall[1];

    return functionCall[2].trim()
      ? `Calls the function \`${name}()\` with the provided argument(s).`
      : `Calls the function \`${name}()\` without arguments.`;
  }

  // ----------------------------------------------------------
  // HTML
  // ----------------------------------------------------------

  if (language === "html") {
    const htmlTag = trimmed.match(/^<([A-Za-z][\w-]*)\b/);

    if (htmlTag) {
      return `Creates or starts the HTML \`${htmlTag[1]}\` element.`;
    }

    if (/^<\/[A-Za-z]/.test(trimmed)) {
      return "Closes an HTML element.";
    }
  }

  // ----------------------------------------------------------
  // CSS
  // ----------------------------------------------------------

  if (
    language === "css" &&
    /^[.#]?[A-Za-z][\w-]*\s*\{/.test(trimmed)
  ) {
    return "Starts a CSS rule that defines styling properties for the selected element or class.";
  }

  // ----------------------------------------------------------
  // Fallback
  // ----------------------------------------------------------

  return "Executes a statement or operation that contributes to the program's overall logic.";
} 

// ------------------------------------------------------------
// Local Explanation Engine V2
// ------------------------------------------------------------

// ============================================================
// Potential Issues Detector
// ============================================================

function findPotentialIssues(code, language) {
  const lines = code.split("\n");
  const issues = [];

  const definedVariables = new Set();
  const usedVariables = new Map();

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!line) return;

    // --------------------------------------------------------
    // Detect variable definitions
    // --------------------------------------------------------

    const jsVariable = line.match(
      /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/
    );

    if (jsVariable) {
      definedVariables.add(jsVariable[1]);
    }

    if (language === "python") {
      const pythonVariable = line.match(
        /^([A-Za-z_]\w*)\s*=(?!=)/
      );

      if (pythonVariable) {
        definedVariables.add(pythonVariable[1]);
      }
    }

    // --------------------------------------------------------
    // Detect obvious TODO / FIXME markers
    // --------------------------------------------------------

    if (/\b(TODO|FIXME|XXX)\b/i.test(line)) {
      issues.push({
        line: lineNumber,
        type: "review",
        message:
          "This line contains a TODO/FIXME marker and may represent unfinished work."
      });
    }

    // --------------------------------------------------------
    // Detect empty functions
    // --------------------------------------------------------

    if (
      /^(def\s+\w+\s*\([^)]*\)|(?:async\s+)?function\s+\w+\s*\([^)]*\))\s*:?\s*\{?\s*\}?$/.test(
        line
      )
    ) {
      issues.push({
        line: lineNumber,
        type: "warning",
        message:
          "This function appears to have no implementation yet."
      });
    }

    // --------------------------------------------------------
    // Detect console/debug statements
    // --------------------------------------------------------

    if (
      /\bconsole\.log\s*\(/.test(line) ||
      /\bdebugger\b/.test(line)
    ) {
      issues.push({
        line: lineNumber,
        type: "review",
        message:
          "This looks like debugging code. Consider removing it before production if it is no longer needed."
      });
    }

    // --------------------------------------------------------
    // Detect very broad exception handling
    // --------------------------------------------------------

    if (
      language === "python" &&
      /^except\s*:\s*$/.test(line)
    ) {
      issues.push({
        line: lineNumber,
        type: "warning",
        message:
          "This catches every exception without specifying an exception type. More specific exception handling is usually safer."
      });
    }

    // --------------------------------------------------------
    // Detect suspicious hard-coded secrets
    // --------------------------------------------------------

    if (
      /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']+["']/i.test(
        line
      )
    ) {
      issues.push({
        line: lineNumber,
        type: "security",
        message:
          "This line may contain a hard-coded secret or credential. Sensitive values should normally be stored securely outside the source code."
      });
    }

    // --------------------------------------------------------
    // Detect common infinite-loop patterns
    // --------------------------------------------------------

    if (
      /^while\s*\(\s*true\s*\)/.test(line) ||
      /^while\s+True\s*:/.test(line)
    ) {
      issues.push({
        line: lineNumber,
        type: "review",
        message:
          "This is an intentionally infinite loop unless a break or another exit condition is provided."
      });
    }

    // --------------------------------------------------------
    // Track simple identifier usage
    // --------------------------------------------------------

    const identifiers = line.match(
      /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g
    );

    if (identifiers) {
      identifiers.forEach((name) => {
        if (!usedVariables.has(name)) {
          usedVariables.set(name, lineNumber);
        }
      });
    }
  });

  // ----------------------------------------------------------
  // Detect common unused variables
  // ----------------------------------------------------------

  definedVariables.forEach((variable) => {
    let usageCount = 0;

    lines.forEach((line) => {
      const matches = line.match(
        new RegExp(`\\b${variable}\\b`, "g")
      );

      if (matches) {
        usageCount += matches.length;
      }
    });

    if (usageCount <= 1) {
      const definitionLine = lines.findIndex((line) =>
        new RegExp(`\\b${variable}\\b`).test(line)
      );

      issues.push({
        line: definitionLine + 1,
        type: "review",
        message:
          `Variable \`${variable}\` appears to be declared or assigned but may not be used later.`
      });
    }
  });

  return issues;
}

function generateLocalExplanation(code, language, difficulty) {
  const detectedLanguage = detectLanguage(code, language);
  const structure = analyzeStructure(code, detectedLanguage);
  const issues = findPotentialIssues(code, detectedLanguage);

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

// Potential Issues
if (issues.length > 0) {
  explanation += `## Potential Issues\n\n`;

  issues.slice(0, 10).forEach((issue) => {
    const icon =
      issue.type === "security"
        ? "🔐"
        : issue.type === "warning"
        ? "⚠️"
        : "💡";

    explanation += `- ${icon} **Line ${issue.line}:** ${issue.message}\n`;
  });

  if (issues.length > 10) {
    explanation += `- ...and ${issues.length - 10} more potential issue(s).\n`;
  }

  explanation += `\n`;
} else {
  explanation += `## Potential Issues\n\n`;
  explanation += `No obvious issues were detected by the local rule-based analyzer.\n\n`;
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
