import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalExplanation } from "../../src/localEngine/core/engineRunner.js";

function lineByLine(explanation) {
  return explanation.split("## Line-by-Line Explanation")[1].split("## Key Concepts")[0];
}

test("Go: explains defer, goroutines, and panic (previously all fell to the generic fallback)", () => {
  const out = lineByLine(generateLocalExplanation(
    'func run() {\n    defer cleanup()\n    go logAccess(id)\n    panic(err)\n}',
    "go"
  ));
  assert.match(out, /Schedules `cleanup\(\)` to run right before the surrounding function returns/);
  assert.match(out, /Starts `logAccess\(id\)` running concurrently in a new goroutine/);
  assert.match(out, /Panics with `err`/);
});

test("Rust: a match arm is described as a pattern match, not a mislabeled implicit return", () => {
  const out = lineByLine(generateLocalExplanation(
    'fn main() {\n    match result {\n        Ok(value) => println!("{}", value),\n        Err(e) => println!("{}", e),\n    }\n}',
    "rust"
  ));
  assert.match(out, /Matches the `Ok\(value\)` pattern/);
  assert.doesNotMatch(out, /Ok\(value\) => println.*as the value returned/);
});

test("Rust: `if let` is described as pattern destructuring, not a boolean check", () => {
  const out = lineByLine(generateLocalExplanation(
    'fn main() {\n    if let Some(name) = maybe_name {\n        println!("{}", name);\n    }\n}',
    "rust"
  ));
  assert.match(out, /destructures it/);
  assert.doesNotMatch(out, /Checks whether `let Some/);
});

test("Swift: guard let, if let, and nil-coalescing all get real explanations", () => {
  const out = lineByLine(generateLocalExplanation(
    'func f() {\n    guard let record = find(id) else {\n        return nil\n    }\n    if let name = user?.name {\n        print(name)\n    }\n    let age = user?.age ?? 0\n}',
    "swift"
  ));
  assert.match(out, /Swift's `guard let`/);
  assert.match(out, /Swift's optional binding/);
  assert.match(out, /nil-coalescing `\?\?`/);
});

test("C#: a nullable return type (`User?`) is recognized as a method definition", () => {
  const out = lineByLine(generateLocalExplanation(
    'public User? FindUser(string id)\n{\n    return null;\n}',
    "csharp"
  ));
  assert.match(out, /Defines the method `FindUser`.*returns `User\?`/);
});

test("C#: `using (resource) { }` is explained as scoped disposal, not the generic fallback", () => {
  const out = lineByLine(generateLocalExplanation(
    'using (var conn = new SqlConnection(s))\n{\n    conn.Open();\n}',
    "csharp"
  ));
  assert.match(out, /guarantees it will be disposed/);
});

test("Allman-style lone opening braces are explained instead of falling to the generic fallback", () => {
  const out = lineByLine(generateLocalExplanation(
    'void run()\n{\n    doWork();\n}',
    "java"
  ));
  assert.match(out, /Opens a new block of code/);
});

test("SQL: explains a CTE (WITH ... AS) and HAVING, and distinguishes LEFT JOIN from a plain JOIN", () => {
  const out = lineByLine(generateLocalExplanation(
    "WITH recent AS (\n    SELECT * FROM orders\n)\nSELECT u.name FROM users u\nJOIN recent r ON r.user_id = u.id\nLEFT JOIN payments p ON p.order_id = r.id\nGROUP BY u.name\nHAVING COUNT(r.id) > 5;",
    "sql"
  ));
  assert.match(out, /Starts a CTE .*`recent`/);
  assert.match(out, /like `WHERE`, but applied after `GROUP BY`/);
  assert.match(out, /keeping every row from the left\/first table/);
  assert.doesNotMatch(out, /^- \*\*Line 5:\*\*.*keeping every row/);
});
