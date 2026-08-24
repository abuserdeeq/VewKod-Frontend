// Replace with your deployed Render backend URL
const API_BASE_URL = "https://vewkod.onrender.com";

/**
 * Fallback local explanation generator
 * Used when backend is unavailable
 */
function generateLocalExplanation(code, language, difficulty) {
  const lines = code.trim().split("\n").filter(l => l.trim());
  const lineCount = lines.length;

  // Detect common patterns
  const hasFunction = /\b(def|function|func|void|int|float|double|String|public|private|static)\b/.test(code);
  const hasLoop = /\b(for|while|do\s*\{|foreach|forEach)\b/.test(code);
  const hasConditional = /\b(if|else|switch|case|elif|else if)\b/.test(code);
  const hasClass = /\b(class|struct|interface|enum)\b/.test(code);
  const hasImport = /\b(import|from|require|#include|using|package)\b/.test(code);
  const hasPrint = /\b(print|console\.log|printf|cout|System\.out|echo)\b/.test(code);
  const hasReturn = /\breturn\b/.test(code);
  const hasList = /\[.*\]|\b(list|array|Array|vector|map|dict)\b/.test(code);
  const hasVariable = /\b(var|let|const|int|float|str|string|bool|boolean|double|char)\b/.test(code);

  let detailLevel = difficulty === "beginner" ? "simple" : difficulty === "intermediate" ? "moderate" : "detailed";

  let explanation = `## Overview\n\n`;
  explanation += `This is a **${language}** code snippet consisting of **${lineCount} line${lineCount !== 1 ? "s" : ""}**. `;

  if (hasClass) explanation += `It defines a class/structure, which is a blueprint for creating objects. `;
  if (hasFunction) explanation += `It contains one or more functions (methods), which are reusable blocks of code. `;
  if (hasImport) explanation += `It imports/includes external libraries or modules. `;

  explanation += `\n\n`;

  // Structure breakdown
  explanation += `## Structure Breakdown\n\n`;

  if (hasImport) {
    explanation += `### 1. Imports/Includes\n`;
    explanation += `The code starts by importing necessary libraries or modules. This makes external functionality available for use in the program.\n\n`;
  }

  if (hasClass) {
    explanation += `### ${hasImport ? "2" : "1"}. Class Definition\n`;
    explanation += `A class is defined here. Classes bundle data (variables) and behavior (methods) together. `;
    explanation += `Think of a class like a template or blueprint.\n\n`;
  }

  if (hasFunction) {
    const fnNum = [hasImport, hasClass].filter(Boolean).length + 1;
    explanation += `### ${fnNum}. Function(s)\n`;
    explanation += `Functions are reusable blocks of code designed to perform specific tasks. `;
    if (hasReturn) explanation += `This function returns a value after processing. `;
    explanation += `Functions help organize code and avoid repetition.\n\n`;
  }

  if (hasVariable) {
    explanation += `### Variables\n`;
    explanation += `Variables are used to store data values. They act as containers for information that the program can use and manipulate.\n\n`;
  }

  if (hasLoop) {
    explanation += `### Loop(s)\n`;
    explanation += `The code uses a loop to repeat operations. Loops are essential for processing collections of data or performing repetitive tasks efficiently.\n\n`;
  }

  if (hasConditional) {
    explanation += `### Conditional Logic\n`;
    explanation += `Conditional statements (if/else) allow the program to make decisions based on certain conditions. The code executes different paths depending on whether conditions are true or false.\n\n`;
  }

  if (hasList) {
    explanation += `### Data Structures\n`;
    explanation += `The code uses arrays/lists to store multiple values in a single variable. This is useful for managing collections of related data.\n\n`;
  }

  if (hasPrint) {
    explanation += `### Output\n`;
    explanation += `The code produces output, likely displaying information to the user or developer.\n\n`;
  }

  // Line-by-line (for beginner/intermediate)
  if (difficulty !== "advanced") {
    explanation += `## Line-by-Line Summary\n\n`;
    lines.slice(0, 10).forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) {
        explanation += `- **Line ${idx + 1}**: Comment (explanatory note, not executed)\n`;
      } else if (/\b(def|function|func)\b/.test(trimmed)) {
        explanation += `- **Line ${idx + 1}**: Defines a function\n`;
      } else if (/\b(for|while)\b/.test(trimmed)) {
        explanation += `- **Line ${idx + 1}**: Starts a loop\n`;
      } else if (/\b(if|else|elif)\b/.test(trimmed)) {
        explanation += `- **Line ${idx + 1}**: Conditional check\n`;
      } else if (/\b(return)\b/.test(trimmed)) {
        explanation += `- **Line ${idx + 1}**: Returns a value\n`;
      } else if (/\b(import|from|include|using)\b/.test(trimmed)) {
        explanation += `- **Line ${idx + 1}**: Imports/includes dependencies\n`;
      } else if (/\b(print|console\.log|printf|cout)\b/.test(trimmed)) {
        explanation += `- **Line ${idx + 1}**: Outputs/prints data\n`;
      } else if (/[=]/.test(trimmed) && !/==/.test(trimmed)) {
        explanation += `- **Line ${idx + 1}**: Assigns a value to a variable\n`;
      } else {
        explanation += `- **Line ${idx + 1}**: Executes an operation\n`;
      }
    });
    if (lines.length > 10) {
      explanation += `- ... and ${lines.length - 10} more lines\n`;
    }
    explanation += `\n`;
  }

  // Key concepts based on difficulty
  explanation += `## Key Concepts\n\n`;

  if (difficulty === "beginner") {
    explanation += `- **Readability**: The code is structured to be readable, with clear naming\n`;
    explanation += `- **Execution Flow**: Code runs from top to bottom, line by line\n`;
    explanation += `- **Reusability**: Functions allow code to be used multiple times\n`;
  } else if (difficulty === "intermediate") {
    explanation += `- **Modularity**: Code is organized into logical sections\n`;
    explanation += `- **Data Flow**: Understanding how data moves through the program\n`;
    explanation += `- **Best Practices**: Follows conventions for the ${language} language\n`;
  } else {
    explanation += `- **Algorithm Analysis**: Consider time and space complexity\n`;
    explanation += `- **Design Patterns**: May follow specific architectural patterns\n`;
    explanation += `- **Edge Cases**: Consider how the code handles unexpected inputs\n`;
  }

  explanation += `\n---\n\n`;
  explanation += `*Note: This is a locally-generated explanation. Connect to the backend for AI-powered analysis.*`;

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
