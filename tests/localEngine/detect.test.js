import test from "node:test";
import assert from "node:assert/strict";
import { detectLanguage } from "../../src/localEngine/core/engineRunner.js";

// One representative snippet per supported language. These are the
// exact shapes that previously caused cross-language misdetection
// (Ruby/Swift vs Python, PHP vs Bash) — keep them as regression guards.
const SAMPLES = {
  python: "def f(x):\n    return x",
  javascript: "const x = 5;\nconsole.log(x);",
  typescript: "const x: number = 5;",
  java: 'public class M { public static void main(String[] a) { int x=5; } }',
  c: "#include <stdio.h>\nint main(){return 0;}",
  cpp: "#include <iostream>\nint main(){std::cout<<1;}",
  html: "<!DOCTYPE html><html><body></body></html>",
  css: ".a{color:red;}",
  sql: "SELECT * FROM t",
  csharp: "using System;\nclass P{static void Main(){Console.WriteLine(1);}}",
  go: "package main\nfunc main(){}",
  rust: "fn main(){let x=5;}",
  php: "<?php echo 1; ?>",
  ruby: "def f\n  puts 1\nend",
  swift: "import Foundation\nfunc f(){print(1)}",
  kotlin: "fun main(){println(1)}",
  bash: "#!/bin/bash\necho \"hi\"",
};

test("detectLanguage identifies every supported language correctly", () => {
  for (const [expected, code] of Object.entries(SAMPLES)) {
    const detected = detectLanguage(code, "auto");
    assert.equal(detected, expected, `expected ${expected}, got ${detected} for:\n${code}`);
  }
});

test("detectLanguage respects an explicit language override", () => {
  // Even ambiguous/empty code should trust an explicit selection.
  assert.equal(detectLanguage("", "python"), "python");
  assert.equal(detectLanguage("some random text", "sql"), "sql");
});
