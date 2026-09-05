import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalExplanation } from "../../src/localEngine/core/engineRunner.js";

function lineByLine(explanation) {
  return explanation.split("## Line-by-Line Explanation")[1].split("## Key Concepts")[0];
}

test("Go: explains defer, goroutines, and panic (previously all fell to the generic fallback)", async () => {
  const out = lineByLine(await generateLocalExplanation(
    'func run() {\n    defer cleanup()\n    go logAccess(id)\n    panic(err)\n}',
    "go"
  ));
  assert.match(out, /Schedules `cleanup\(\)` to run right before the surrounding function returns/);
  assert.match(out, /Starts `logAccess\(id\)` running concurrently in a new goroutine/);
  assert.match(out, /Panics with `err`/);
});

test("Rust: a match arm is described as a pattern match, not a mislabeled implicit return", async () => {
  const out = lineByLine(await generateLocalExplanation(
    'fn main() {\n    match result {\n        Ok(value) => println!("{}", value),\n        Err(e) => println!("{}", e),\n    }\n}',
    "rust"
  ));
  assert.match(out, /Matches the `Ok\(value\)` pattern/);
  assert.doesNotMatch(out, /Ok\(value\) => println.*as the value returned/);
});

test("Rust: `if let` is described as pattern destructuring, not a boolean check", async () => {
  const out = lineByLine(await generateLocalExplanation(
    'fn main() {\n    if let Some(name) = maybe_name {\n        println!("{}", name);\n    }\n}',
    "rust"
  ));
  assert.match(out, /destructures it/);
  assert.doesNotMatch(out, /Checks whether `let Some/);
});

test("Swift: guard let, if let, and nil-coalescing all get real explanations", async () => {
  const out = lineByLine(await generateLocalExplanation(
    'func f() {\n    guard let record = find(id) else {\n        return nil\n    }\n    if let name = user?.name {\n        print(name)\n    }\n    let age = user?.age ?? 0\n}',
    "swift"
  ));
  assert.match(out, /Swift's `guard let`/);
  assert.match(out, /Swift's optional binding/);
  assert.match(out, /nil-coalescing `\?\?`/);
  // Regression guard for a real bug: the bound name is a SIBLING of
  // value_binding_pattern in the AST, not nested inside it, so a naive
  // lookup silently fell back to "?" here while still matching the
  // three loose assertions above (the template phrase appears either
  // way). Pin down the actual unwrapped name/expression too.
  assert.match(out, /Unwraps `find\(id\)`/);
  assert.match(out, /makes the value available as `record`/);
  assert.match(out, /unwraps it and makes it available as `name`/);
  assert.match(out, /If `user\?\.name` isn't `nil`/);
  assert.doesNotMatch(out, /as `\?`/);
  assert.doesNotMatch(out, /Unwraps `\?`/);
});

test("Kotlin: for-loop names the actual iterable, not the loop variable twice", async () => {
  const out = lineByLine(await generateLocalExplanation(
    'fun run() {\n    for (item in items) {\n        println(item)\n    }\n}',
    "kotlin"
  ));
  // Regression guard for a real bug: for_statement's children are
  // [variable_declaration, simple_identifier, control_structure_body]
  // and the old code excluded the loop-var slot by node identity
  // (`c !== varNode`), which silently never matches with
  // web-tree-sitter — so `iterable` fell back to the FIRST child
  // (variable_declaration, i.e. the loop variable itself) instead of
  // the actual iterable.
  assert.match(out, /Iterates over `items`/);
  assert.doesNotMatch(out, /Iterates over `item`;/);
});

test("C#: a nullable return type (`User?`) is recognized as a method definition", async () => {
  const out = lineByLine(await generateLocalExplanation(
    'public User? FindUser(string id)\n{\n    return null;\n}',
    "csharp"
  ));
  assert.match(out, /Defines the method `FindUser`.*returns `User\?`/);
});

test("C#: `using (resource) { }` is explained as scoped disposal, not the generic fallback", async () => {
  const out = lineByLine(await generateLocalExplanation(
    'using (var conn = new SqlConnection(s))\n{\n    conn.Open();\n}',
    "csharp"
  ));
  assert.match(out, /guarantees it will be disposed/);
});

test("Allman-style lone opening braces are explained instead of falling to the generic fallback", async () => {
  const out = lineByLine(await generateLocalExplanation(
    'void run()\n{\n    doWork();\n}',
    "java"
  ));
  assert.match(out, /Opens a new block of code/);
});

test("SQL: explains a CTE (WITH ... AS) and HAVING, and distinguishes LEFT JOIN from a plain JOIN", async () => {
  const out = lineByLine(await generateLocalExplanation(
    "WITH recent AS (\n    SELECT * FROM orders\n)\nSELECT u.name FROM users u\nJOIN recent r ON r.user_id = u.id\nLEFT JOIN payments p ON p.order_id = r.id\nGROUP BY u.name\nHAVING COUNT(r.id) > 5;",
    "sql"
  ));
  assert.match(out, /Starts a CTE .*`recent`/);
  assert.match(out, /like `WHERE`, but applied after `GROUP BY`/);
  assert.match(out, /keeping every row from the left\/first table/);
  assert.doesNotMatch(out, /^- \*\*Line 5:\*\*.*keeping every row/);
});
