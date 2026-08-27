import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalExplanation } from "../../src/localEngine/core/engineRunner.js";

function issuesSection(explanation) {
  return explanation.split("## Potential Issues")[1] || "";
}

test("Flags eval() usage as a security issue", () => {
  const code = 'const result = eval(userInput);\nconsole.log(result);';
  const out = generateLocalExplanation(code, "javascript");
  assert.match(issuesSection(out), /`eval\(\)` executes arbitrary code/);
});

test("Flags string-concatenated SQL queries as a possible injection risk", () => {
  const jsOut = generateLocalExplanation(
    'const query = "SELECT * FROM users WHERE id = " + userId;\nconsole.log(query);',
    "javascript"
  );
  assert.match(issuesSection(jsOut), /SQL injection/);

  const phpOut = generateLocalExplanation(
    '<?php\n$query = "SELECT * FROM users WHERE id = " . $id;\necho $query;',
    "php"
  );
  assert.match(issuesSection(phpOut), /SQL injection/);
});

test("Does not flag parameterized queries as SQL injection risks", () => {
  const out = generateLocalExplanation(
    'cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))',
    "python"
  );
  assert.doesNotMatch(issuesSection(out), /SQL injection/);
});

test("Flags hard-coded AWS access keys", () => {
  const out = generateLocalExplanation(
    'const key = "AKIAABCDEFGHIJKLMNOP";\nconsole.log(key);',
    "javascript"
  );
  assert.match(issuesSection(out), /AWS access key/);
});

test("Does not flag ordinary, safe code with new false positives", () => {
  const out = generateLocalExplanation(
    "def add(a, b):\n    return a + b\n\nresult = add(1, 2)\nprint(result)",
    "python"
  );
  assert.match(issuesSection(out), /No obvious issues were detected/);
});
