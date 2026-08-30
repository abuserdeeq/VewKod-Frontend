import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalExplanation } from "../../src/localEngine/core/engineRunner.js";

function lineByLine(explanation) {
  return explanation.split("## Line-by-Line Explanation")[1].split("## Key Concepts")[0];
}

test("Kotlin: explains a bare function call, try, and catch (previously all fell to the generic fallback)", () => {
  const out = lineByLine(generateLocalExplanation(
    'fun main() {\n    try {\n        greet(users)\n    } catch (e: Exception) {\n        println(e.message)\n    }\n}',
    "kotlin"
  ));
  assert.match(out, /Calls `greet\(\)`, passing `users`/);
  assert.match(out, /Starts a `try` block/);
  assert.match(out, /Catches an exception\/error here \(`e: Exception`\)/);
});

test("Java: explains try/finally and a no-argument call", () => {
  const out = lineByLine(generateLocalExplanation(
    'void run() {\n    try {\n        cleanup();\n    } finally {\n        done();\n    }\n}',
    "java"
  ));
  assert.match(out, /Starts a `try` block/);
  assert.match(out, /Calls `cleanup\(\)` without passing any arguments/);
  assert.match(out, /Starts a `finally` block/);
});

test("C++: explains a catch-all `catch (...)` and a function definition header", () => {
  const out = lineByLine(generateLocalExplanation(
    'void run() {\n    try {\n        load();\n    } catch (...) {\n        fail();\n    }\n}',
    "cpp"
  ));
  assert.match(out, /Defines the function `run` without parameters/);
  assert.match(out, /catch-all handler/);
});

test("C++: recognizes std::cerr the same way it already recognizes std::cout", () => {
  const out = lineByLine(generateLocalExplanation(
    'void warn() {\n    std::cerr << "oops";\n}',
    "cpp"
  ));
  assert.match(out, /standard error/);
});

test("Bash: explains a paren-less function/command call (backup_files, notify_admin \"done\")", () => {
  const out = lineByLine(generateLocalExplanation(
    '#!/bin/bash\nbackup_files\nnotify_admin "done"\n',
    "bash"
  ));
  assert.match(out, /Runs the `backup_files` command\./);
  assert.match(out, /Runs the `notify_admin` command, passing `"done"`\./);
});

test("Bash: a defined function is called out as 'the X function', not 'command'", () => {
  const out = lineByLine(generateLocalExplanation(
    'cleanup() {\n    echo "done"\n}\ncleanup\n',
    "bash"
  ));
  assert.match(out, /Runs the `cleanup` function\./);
});

test("Go: a call that passes a known variable names that variable specifically", () => {
  const out = lineByLine(generateLocalExplanation(
    'func main() {\n    users := fetchUsers()\n    printReport(users)\n}',
    "go"
  ));
  assert.match(out, /Calls `printReport\(\)`, passing `users`\./);
});
