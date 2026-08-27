import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalExplanation } from "../../src/localEngine/core/engineRunner.js";

function lineOf(explanation, lineNumber) {
  // Restrict the search to the "Line-by-Line Explanation" section —
  // "Structure Breakdown" also has "**Line N:**" entries with
  // different (shorter) wording, and would otherwise shadow the match.
  const sectionStart = explanation.indexOf("## Line-by-Line Explanation");
  const section = sectionStart === -1 ? explanation : explanation.slice(sectionStart);
  const re = new RegExp(`\\*\\*Line ${lineNumber}:\\*\\* (.+)`);
  const match = section.match(re);
  return match ? match[1] : null;
}

test("Python: list/loop-item symbol tracking + method calls", () => {
  const code = [
    "def get_active_users(users):",
    "    active = []",
    "    for user in users:",
    "        if user:",
    "            active.append(user)",
    "    return active",
  ].join("\n");

  const out = generateLocalExplanation(code, "python");

  // `users` is a function *parameter* here (not a literal list
  // assignment), so the engine correctly doesn't claim to know its
  // exact type — it still tracks that `user` is the current item.
  assert.match(lineOf(out, 3), /Iterates over `users`.*`user` represents the current item/);
  assert.match(lineOf(out, 4), /current item \(`user`\)/);
  assert.match(lineOf(out, 5), /Calls `\.append\(user\)` on the `active` list/);
});

test("Go: multi-value short declaration + unchecked err issue", () => {
  const code = [
    "package main",
    "",
    'import "fmt"',
    "",
    "func divide(a, b int) (int, error) {",
    "  return a / b, nil",
    "}",
    "",
    "func main() {",
    "  result, err := divide(10, 2)",
    "  fmt.Println(result, err)",
    "}",
  ].join("\n");

  const out = generateLocalExplanation(code, "go");

  assert.match(lineOf(out, 10), /storing the result in `result` and any error in `err`/);
  assert.match(out, /doesn't appear to be checked with `if err != nil`/);
});

test("PHP: variables keep their $ sigil in descriptions", () => {
  const code = [
    "<?php",
    "function greetUsers($users) {",
    "    foreach ($users as $user) {",
    "        if ($user) {",
    '            echo "Hello, " . $user;',
    "        }",
    "    }",
    "}",
  ].join("\n");

  const out = generateLocalExplanation(code, "php");

  assert.match(lineOf(out, 3), /\$users.*\$user/);
  assert.match(lineOf(out, 4), /`\$user`/);
  assert.doesNotMatch(lineOf(out, 4), /\(a array\)/); // grammar bug regression guard
});

test("Kotlin: nullable type declarations and !! inside call expressions", () => {
  const code = [
    "fun main() {",
    "    var nickname: String? = null",
    "    println(nickname!!)",
    "}",
  ].join("\n");

  const out = generateLocalExplanation(code, "kotlin");

  assert.match(lineOf(out, 2), /Declares the mutable property `nickname`/);
  assert.match(out, /non-null assertion throws if the value is actually `null`/);
});

test("Rust: implicit-return expressions and .unwrap() issue", () => {
  const code = [
    "fn divide(a: i32, b: i32) -> i32 {",
    "    a / b",
    "}",
    "",
    "fn main() {",
    "    let nums = vec![10, 20, 30];",
    "    let risky = nums.get(5).unwrap();",
    "}",
  ].join("\n");

  const out = generateLocalExplanation(code, "rust");

  assert.match(lineOf(out, 2), /implicit-return/);
  assert.match(out, /`\.unwrap\(\)` panics/);
});

test("Python: same variable name in two different functions doesn't cross-contaminate", () => {
  const code = [
    "def first():",
    "    x = [1, 2, 3]",
    "    for item in x:",
    "        print(item)",
    "",
    "def second():",
    "    x = 5",
    "    if x:",
    "        print(x)",
  ].join("\n");

  const out = generateLocalExplanation(code, "python");

  assert.match(lineOf(out, 2), /Creates the list `x`/);
  assert.match(lineOf(out, 7), /Assigns `5` to the variable `x`/);
  assert.match(lineOf(out, 8), /number stored in `x`/);
  assert.match(lineOf(out, 9), /number stored in `x`/);
});
test("JavaScript: same variable name in two different functions doesn't cross-contaminate", () => {
  const code = [
    "function first() {",
    "  const x = [1, 2, 3];",
    "  for (const item of x) {",
    "    console.log(item);",
    "  }",
    "}",
    "",
    "function second() {",
    "  const x = 5;",
    "  if (x) {",
    "    console.log(x);",
    "  }",
    "}",
  ].join("\n");

  const out = generateLocalExplanation(code, "javascript");

  assert.match(lineOf(out, 2), /Creates the `const` array `x`/);
  assert.match(lineOf(out, 10), /number stored in `x`/);
  assert.match(lineOf(out, 11), /number stored in `x`/);
});

test("Java: same variable name in two different methods doesn't cross-contaminate", () => {
  const code = [
    "public class Test {",
    "  public static void first() {",
    "    ArrayList<Integer> x = new ArrayList<>();",
    "    if (x) {",
    "    }",
    "  }",
    "  public static void second() {",
    "    int x = 10;",
    "    if (x) {",
    "    }",
    "  }",
    "}",
  ].join("\n");

  const out = generateLocalExplanation(code, "java");

  assert.match(lineOf(out, 4), /the `x` list/);
  assert.match(lineOf(out, 9), /number stored in `x`/);
});

test("Go: same variable name in two different functions doesn't cross-contaminate", () => {
  const code = [
    "package main",
    "func first() {",
    "  x := []int{1, 2, 3}",
    "  if x {",
    "  }",
    "}",
    "func second() {",
    "  x := 10",
    "  if x {",
    "  }",
    "}",
  ].join("\n");

  const out = generateLocalExplanation(code, "go");

  assert.match(lineOf(out, 4), /the `x` list/);
  assert.match(lineOf(out, 9), /number stored in `x`/);
});

test("Snippets longer than the line cap don't crash and summarize the rest", () => {
  const lines = ["def outer():"];
  for (let i = 0; i < 45; i++) lines.push(`    y${i} = ${i}`);
  lines.push("def another():");
  lines.push("    for i in range(10):");
  lines.push("        if i:");
  lines.push("            print(i)");
  const code = lines.join("\n");

  assert.doesNotThrow(() => generateLocalExplanation(code, "python"));
  const out = generateLocalExplanation(code, "python");
  assert.match(out, /more lines not shown individually/);
  assert.match(out, /`another`/);
});
