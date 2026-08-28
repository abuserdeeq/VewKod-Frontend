import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalExplanation } from "../../src/localEngine/core/engineRunner.js";

function lineOf(explanation, lineNumber) {
  const sectionStart = explanation.indexOf("## Line-by-Line Explanation");
  const section = sectionStart === -1 ? explanation : explanation.slice(sectionStart);
  const re = new RegExp(`\\*\\*Line ${lineNumber}:\\*\\* (.+)`);
  const match = section.match(re);
  return match ? match[1] : null;
}

test("JavaScript: try/catch/throw are explained specifically, not generically", () => {
  const code = [
    "async function getUserData(userId) {",
    "    try {",
    "        const response = await fetch(`/api/users/${userId}`);",
    "",
    "        if (!response.ok) {",
    "            throw new Error('Failed to fetch user');",
    "        }",
    "",
    "        const data = await response.json();",
    "        return data;",
    "    } catch (error) {",
    "        console.error('Error:', error);",
    "        return null;",
    "    }",
    "}",
  ].join("\n");

  const out = generateLocalExplanation(code, "javascript");

  assert.match(lineOf(out, 2), /Starts a `try` block/);
  assert.match(lineOf(out, 6), /Throws an error/);
  assert.match(lineOf(out, 11), /Catches any error thrown in the `try` block above.*`error`/);
  assert.match(lineOf(out, 12), /Logs an error.*to the console/);

  // console.error should count as an output statement in the structure
  // breakdown, not be silently skipped the way it was before this fix.
  assert.match(out, /### Output/);

  // A single top-level function that isn't called within its own snippet
  // is completely normal and should NOT be flagged as an unused variable
  // (this was a false positive on nearly every single-function snippet).
  assert.doesNotMatch(out, /getUserData.*may not be used later/);
});

test("TypeScript inherits the same try/catch/throw handling via the JS analyzer", () => {
  const code = [
    "function parse(input: string): number {",
    "  try {",
    "    return parseInt(input, 10);",
    "  } catch (err) {",
    "    throw new Error('bad input');",
    "  }",
    "}",
  ].join("\n");

  const out = generateLocalExplanation(code, "typescript");

  assert.match(lineOf(out, 2), /Starts a `try` block/);
  assert.match(lineOf(out, 4), /Catches any error thrown/);
  assert.match(lineOf(out, 5), /Throws an error/);
});

test("Python: try/except/finally/raise are explained specifically", () => {
  const code = [
    "def divide(a, b):",
    "    try:",
    "        result = a / b",
    "    except ZeroDivisionError as e:",
    '        print("Cannot divide by zero")',
    "        raise",
    "    finally:",
    '        print("Done")',
    "    return result",
  ].join("\n");

  const out = generateLocalExplanation(code, "python");

  assert.match(lineOf(out, 2), /Starts a `try` block/);
  assert.match(lineOf(out, 4), /Catches a `ZeroDivisionError` exception.*`e`/);
  assert.match(lineOf(out, 6), /Re-raises the exception/);
  assert.match(lineOf(out, 7), /Starts a `finally` block/);

  // A top-level function not called within its own snippet is normal and
  // should not be flagged as unused (same false-positive class as JS).
  assert.doesNotMatch(out, /divide.*may not be used later/);
});

test("Python: a genuinely unused variable is still flagged (the fix doesn't over-correct)", () => {
  const code = [
    "def compute():",
    "    unused_value = 42",
    "    return 1",
  ].join("\n");

  const out = generateLocalExplanation(code, "python");
  assert.match(out, /unused_value.*may not be used later/);
});

test("JavaScript: a template literal value doesn't break the Markdown code span", () => {
  const code = [
    "async function getUserData(userId) {",
    "  const response = await fetch(`/api/users/${userId}`);",
    "  return response;",
    "}",
  ].join("\n");

  const out = generateLocalExplanation(code, "javascript");
  const line = lineOf(out, 2);

  // A single backtick wrap around a value that itself contains backticks
  // (a template literal) would prematurely close the Markdown code span,
  // leaving stray backtick characters in the rendered output. The fix
  // uses a longer backtick fence (``...``) whenever the content contains
  // a backtick, so the whole expression stays inside one code span.
  assert.match(line, /``await fetch\(`\/api\/users\/\$\{userId\}`\)``/);

  // Sanity check: no lone, unpaired single-backtick fragments remain
  // around the template literal (the old, broken behavior).
  assert.doesNotMatch(line, /[^`]`await fetch\(`[^`]/);
});
