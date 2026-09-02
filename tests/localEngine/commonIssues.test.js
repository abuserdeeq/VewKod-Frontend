import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalExplanation } from "../../src/localEngine/core/engineRunner.js";

function issuesSection(explanation) {
  return explanation.split("## Potential Issues")[1] || "";
}

// ============================================================
// Empty error-handling block (catch / except)
// ============================================================

test("Flags an empty brace-based catch block (same-line)", async () => {
  const out = await generateLocalExplanation(
    'try {\n  risky();\n} catch (e) {}\n',
    "javascript"
  );
  assert.match(issuesSection(out), /error handler is empty/);
});

test("Flags an empty brace-based catch block (multi-line)", async () => {
  const out = await generateLocalExplanation(
    'try {\n    risky();\n} catch (Exception e) {\n}\n',
    "java"
  );
  assert.match(issuesSection(out), /error handler is empty/);
});

test("Flags an empty catch block in Allman brace style (opening brace on its own line)", async () => {
  // Regression test: this style — `catch (...)` on one line, the `{`
  // on the next, `}` closing immediately after — was missed by the
  // original regex, which only handled the brace sitting on the same
  // line as `catch`. Common in default C#/Java IDE formatting.
  const out = await generateLocalExplanation(
    'try\n{\n    risky();\n}\ncatch (Exception e)\n{\n}\n',
    "csharp"
  );
  assert.match(issuesSection(out), /error handler is empty/);
});

test("Does not flag an Allman-style catch block that actually does something", async () => {
  const out = await generateLocalExplanation(
    'try\n{\n    Risky();\n}\ncatch (Exception e)\n{\n    Log(e);\n}\n',
    "csharp"
  );
  assert.doesNotMatch(issuesSection(out), /error handler is empty/);
});

test("An Allman-style empty catch still reports alongside the existing broad-exception check", async () => {
  const out = await generateLocalExplanation(
    'try\n{\n    Risky();\n}\ncatch (Exception e)\n{\n}\n',
    "csharp"
  );
  const section = issuesSection(out);
  assert.match(section, /error handler is empty/);
  assert.match(section, /Catches the broad `Exception` type/);
});

test("Flags an empty Python except block (same-line and multi-line)", async () => {
  const sameLine = await generateLocalExplanation(
    'try:\n    risky()\nexcept Exception:\n    pass\n',
    "python"
  );
  assert.match(issuesSection(sameLine), /error handler is empty/);
});

test("Does not flag a catch/except block that actually does something", async () => {
  const jsOut = await generateLocalExplanation(
    'try {\n  risky();\n} catch (e) {\n  logError(e);\n}\n',
    "javascript"
  );
  assert.doesNotMatch(issuesSection(jsOut), /error handler is empty/);

  const pyOut = await generateLocalExplanation(
    'try:\n    risky()\nexcept Exception as e:\n    log(e)\n',
    "python"
  );
  assert.doesNotMatch(issuesSection(pyOut), /error handler is empty/);
});

test("Flags empty catch across several brace-based languages", async () => {
  const cases = {
    csharp: 'try {\n    Risky();\n} catch (Exception e) {}\n',
    kotlin: 'try {\n    risky()\n} catch (e: Exception) {\n}\n',
    php: '<?php\ntry {\n    risky();\n} catch (Exception $e) {}\n',
  };
  for (const [lang, code] of Object.entries(cases)) {
    const out = await generateLocalExplanation(code, lang);
    assert.match(issuesSection(out), /error handler is empty/, `expected empty-handler flag for ${lang}`);
  }
});

// ============================================================
// Division by a literal zero
// ============================================================

test("Flags division by a literal 0", async () => {
  const out = await generateLocalExplanation("result = total / 0\nprint(result)", "python");
  assert.match(issuesSection(out), /divides by a literal `0`/);
});

test("Does not flag division by a decimal like 0.5", async () => {
  const out = await generateLocalExplanation("result = total / 0.5\nprint(result)", "python");
  assert.doesNotMatch(issuesSection(out), /divides by a literal `0`/);
});

test("Does not mistake a `//` comment marker for division", async () => {
  const out = await generateLocalExplanation(
    '// a comment mentioning x / 0 should not trigger\nconst y = 5;',
    "javascript"
  );
  assert.doesNotMatch(issuesSection(out), /divides by a literal `0`/);
});

test("Flags division by zero across several languages", async () => {
  const cases = {
    java: "int bad = 10 / 0;",
    php: "<?php\n$bad = 10 / 0;\n",
    csharp: "int bad = 10 / 0;",
  };
  for (const [lang, code] of Object.entries(cases)) {
    const out = await generateLocalExplanation(code, lang);
    assert.match(issuesSection(out), /divides by a literal `0`/, `expected division-by-zero flag for ${lang}`);
  }
});

// ============================================================
// Unreachable code after `return`
// ============================================================

test("Flags a statement immediately after a return in the same block", async () => {
  const out = await generateLocalExplanation(
    'function f() {\n  return 1;\n  console.log("dead");\n}\n',
    "javascript"
  );
  assert.match(issuesSection(out), /can never be reached/);
});

test("Flags unreachable code in Python (indentation-based)", async () => {
  const out = await generateLocalExplanation(
    'def f(x):\n    return x * 2\n    print("dead code")\n',
    "python"
  );
  assert.match(issuesSection(out), /can never be reached/);
});

test("Does not flag ordinary if/return control flow as unreachable", async () => {
  const jsOut = await generateLocalExplanation(
    'function calc(x) {\n  if (x > 0) {\n    return x;\n  }\n  return -1;\n}\n',
    "javascript"
  );
  assert.doesNotMatch(issuesSection(jsOut), /can never be reached/);

  const goOut = await generateLocalExplanation(
    'func check(x int) int {\n\tif x > 0 {\n\t\treturn x\n\t}\n\treturn -1\n}\n',
    "go"
  );
  assert.doesNotMatch(issuesSection(goOut), /can never be reached/);
});

test("Does not flag a switch/case fall-through dedent after return", async () => {
  const out = await generateLocalExplanation(
    'switch (x) {\n  case 1:\n    return 1;\n  case 2:\n    return 2;\n}\n',
    "javascript"
  );
  assert.doesNotMatch(issuesSection(out), /can never be reached/);
});

// ============================================================
// SQL now runs the shared cross-language checks too
// ============================================================

test("SQL now picks up shared checks like TODO/FIXME markers", async () => {
  const out = await generateLocalExplanation(
    "-- TODO: revisit this query\nSELECT * FROM users;",
    "sql"
  );
  assert.match(issuesSection(out), /TODO\/FIXME marker/);
});

test("SQL still reports its own existing checks alongside the shared ones", async () => {
  const out = await generateLocalExplanation("SELECT * FROM users;", "sql");
  assert.match(issuesSection(out), /SELECT \*/);
});
