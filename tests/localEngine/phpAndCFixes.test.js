import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalExplanation } from "../../src/localEngine/core/engineRunner.js";

function lineByLine(explanation) {
  return explanation.split("## Line-by-Line Explanation")[1].split("## Key Concepts")[0];
}

test("PHP: a method with a visibility modifier and nullable return type is recognized as a function", () => {
  const out = lineByLine(generateLocalExplanation(
    'class Repo {\n    public function find(int $id): ?User {\n        return null;\n    }\n}',
    "php"
  ));
  assert.match(out, /Defines the function `find`, which accepts `int \$id`/);
});

test("PHP: throw new X(...) and a match expression (with its arms) are explained", () => {
  const out = lineByLine(generateLocalExplanation(
    'function f($code) {\n    throw new NotFoundException("nope");\n    $s = match($code) {\n        200 => "ok",\n        default => "?",\n    };\n}',
    "php"
  ));
  assert.match(out, /Throws a new `NotFoundException` exception/);
  assert.match(out, /Starts a `match` expression on `\$code`/);
  assert.match(out, /strictly equals `200`.*produces `"ok"`/);
  assert.match(out, /Default arm.*produces `"\?"`/);
});

test("C: #include is a preprocessor directive, not a comment", () => {
  const out = lineByLine(generateLocalExplanation("#include <stdlib.h>\nint x = 1;", "c"));
  assert.match(out, /Includes the `stdlib\.h` header/);
  assert.doesNotMatch(out, /This is a comment/);
});

test("C: recognizes a struct definition, a pointer-returning function, malloc, and pointer-member assignment", () => {
  const out = lineByLine(generateLocalExplanation(
    'struct Node {\n    int value;\n};\n\nstruct Node *make(int v) {\n    struct Node *n = malloc(sizeof(struct Node));\n    n->value = v;\n    return n;\n}',
    "c"
  ));
  assert.match(out, /Defines the `Node` struct/);
  assert.match(out, /Defines the function `make`/);
  assert.match(out, /allocates memory for it on the heap.*free\(n\)/);
  assert.match(out, /Sets the `value` field of the struct that `n` points to/);
});

test("Rust: #[derive(...)] is an attribute, not a comment", () => {
  const out = lineByLine(generateLocalExplanation("#[derive(Debug)]\nstruct Point { x: i32 }", "rust"));
  assert.match(out, /Applies the `#\[derive\(Debug\)\]` attribute/);
  assert.doesNotMatch(out, /This is a comment/);
});
