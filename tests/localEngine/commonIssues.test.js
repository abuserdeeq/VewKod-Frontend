import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalExplanation } from "../../src/localEngine/core/engineRunner.js";

function issuesSection(explanation) {
  return explanation.split("## Potential Issues")[1] || "";
}

// ============================================================
// Empty error-handling block (catch / except)
// ============================================================

test("Flags an empty brace-based catch block (same-line)", () => {
  const out = generateLocalExplanation(
    'try {\n  risky();\n} catch (e) {}\n',
    "javascript"
  );
  assert.match(issuesSection(out), /error handler is empty/);
});

test("Flags an empty brace-based catch block (multi-line)", () => {
  const out = generateLocalExplanation(
    'try {\n    risky();\n} catch (Exception e) {\n}\n',
    "java"
  );
  assert.match(issuesSection(out), /error handler is empty/);
});

test("Flags an empty catch block in Allman brace style (opening brace on its own line)", () => {
  // Regression test: this style — `catch (...)` on one line, the `{`
  // on the next, `}` closing immediately after — was missed by the
  // original regex, which only handled the brace sitting on the same
  // line as `catch`. Common in default C#/Java IDE formatting.
  const out = generateLocalExplanation(
    'try\n{\n    risky();\n}\ncatch (Exception e)\n{\n}\n',
    "csharp"
  );
  assert.match(issuesSection(out), /error handler is empty/);
});

test("Does not flag an Allman-style catch block that actually does something", () => {
  const out = generateLocalExplanation(
    'try\n{\n    Risky();\n}\ncatch (Exception e)\n{\n    Log(e);\n}\n',
    "csharp"
  );
  assert.doesNotMatch(issuesSection(out), /error handler is empty/);
});

test("An Allman-style empty catch still reports alongside the existing broad-exception check", () => {
  const out = generateLocalExplanation(
    'try\n{\n    Risky();\n}\ncatch (Exception e)\n{\n}\n',
    "csharp"
  );
  const section = issuesSection(out);
  assert.match(section, /error handler is empty/);
  assert.match(section, /Catches the broad `Exception` type/);
});

test("Flags an empty Python except block (same-line and multi-line)", () => {
  const sameLine = generateLocalExplanation(
    'try:\n    risky()\nexcept Exception:\n    pass\n',
    "python"
  );
  assert.match(issuesSection(sameLine), /error handler is empty/);
});

test("Does not flag a catch/except block that actually does something", () => {
  const jsOut = generateLocalExplanation(
    'try {\n  risky();\n} catch (e) {\n  logError(e);\n}\n',
    "javascript"
  );
  assert.doesNotMatch(issuesSection(jsOut), /error handler is empty/);

  const pyOut = generateLocalExplanation(
    'try:\n    risky()\nexcept Exception as e:\n    log(e)\n',
    "python"
  );
  assert.doesNotMatch(issuesSection(pyOut), /error handler is empty/);
});

test("Flags empty catch across several brace-based languages", () => {
  const cases = {
    csharp: 'try {\n    Risky();\n} catch (Exception e) {}\n',
    kotlin: 'try {\n    risky()\n} catch (e: Exception) {\n}\n',
    php: '<?php\ntry {\n    risky();\n} catch (Exception $e) {}\n',
  };
  for (const [lang, code] of Object.entries(cases)) {
    const out = generateLocalExplanation(code, lang);
    assert.match(issuesSection(out), /error handler is empty/, `expected empty-handler flag for ${lang}`);
  }
});

// ============================================================
// Division by a literal zero
// ============================================================

test("Flags division by a literal 0", () => {
  const out = generateLocalExplanation("result = total / 0\nprint(result)", "python");
  assert.match(issuesSection(out), /divides by a literal `0`/);
});

test("Does not flag division by a decimal like 0.5", () => {
  const out = generateLocalExplanation("result = total / 0.5\nprint(result)", "python");
  assert.doesNotMatch(issuesSection(out), /divides by a literal `0`/);
});

test("Does not mistake a `//` comment marker for division", () => {
  const out = generateLocalExplanation(
    '// a comment mentioning x / 0 should not trigger\nconst y = 5;',
    "javascript"
  );
  assert.doesNotMatch(issuesSection(out), /divides by a literal `0`/);
});

test("Flags division by zero across several languages", () => {
  const cases = {
    java: "int bad = 10 / 0;",
    php: "<?php\n$bad = 10 / 0;\n",
    csharp: "int bad = 10 / 0;",
  };
  for (const [lang, code] of Object.entries(cases)) {
    const out = generateLocalExplanation(code, lang);
    assert.match(issuesSection(out), /divides by a literal `0`/, `expected division-by-zero flag for ${lang}`);
  }
});

// ============================================================
// Unreachable code after `return`
// ============================================================

test("Flags a statement immediately after a return in the same block", () => {
  const out = generateLocalExplanation(
    'function f() {\n  return 1;\n  console.log("dead");\n}\n',
    "javascript"
  );
  assert.match(issuesSection(out), /can never be reached/);
});

test("Flags unreachable code in Python (indentation-based)", () => {
  const out = generateLocalExplanation(
    'def f(x):\n    return x * 2\n    print("dead code")\n',
    "python"
  );
  assert.match(issuesSection(out), /can never be reached/);
});

test("Does not flag ordinary if/return control flow as unreachable", () => {
  const jsOut = generateLocalExplanation(
    'function calc(x) {\n  if (x > 0) {\n    return x;\n  }\n  return -1;\n}\n',
    "javascript"
  );
  assert.doesNotMatch(issuesSection(jsOut), /can never be reached/);

  const goOut = generateLocalExplanation(
    'func check(x int) int {\n\tif x > 0 {\n\t\treturn x\n\t}\n\treturn -1\n}\n',
    "go"
  );
  assert.doesNotMatch(issuesSection(goOut), /can never be reached/);
});

test("Does not flag a switch/case fall-through dedent after return", () => {
  const out = generateLocalExplanation(
    'switch (x) {\n  case 1:\n    return 1;\n  case 2:\n    return 2;\n}\n',
    "javascript"
  );
  assert.doesNotMatch(issuesSection(out), /can never be reached/);
});

// ============================================================
// SQL now runs the shared cross-language checks too
// ============================================================

test("SQL now picks up shared checks like TODO/FIXME markers", () => {
  const out = generateLocalExplanation(
    "-- TODO: revisit this query\nSELECT * FROM users;",
    "sql"
  );
  assert.match(issuesSection(out), /TODO\/FIXME marker/);
});

test("SQL still reports its own existing checks alongside the shared ones", () => {
  const out = generateLocalExplanation("SELECT * FROM users;", "sql");
  assert.match(issuesSection(out), /SELECT \*/);
});


// ============================================================
// Python AST regression coverage: function parameters + shared checks
// ============================================================

test("Python Structure Breakdown preserves function parameters", async () => {
  const out = await generateLocalExplanation(
    'def init(self, name, age):\n    return name\n',
    "python"
  );
  const section = out.split("## Structure Breakdown")[1].split("## Line-by-Line Explanation")[0];
  assert.match(section, /`init\(\)` accepts `self, name, age`/);
  assert.doesNotMatch(section, /does not define any parameters/);
});

test("Python AST analyzer keeps shared division-by-zero check", async () => {
  const out = await generateLocalExplanation(
    'def broken_function(x):\n    return x / 0\n',
    "python"
  );
  assert.match(issuesSection(out), /divides by a literal `0`/);
});

test("Python AST analyzer keeps shared TODO/FIXME and eval checks", async () => {
  const out = await generateLocalExplanation(
    'def broken_function(x):\n    # TODO: replace this\n    eval(x)\n',
    "python"
  );
  const section = issuesSection(out);
  assert.match(section, /TODO\/FIXME marker/);
  assert.match(section, /`eval\(\)` executes arbitrary code/);
});
