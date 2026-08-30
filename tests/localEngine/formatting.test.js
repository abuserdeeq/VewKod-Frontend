import test from "node:test";
import assert from "node:assert/strict";
import { generateLocalExplanation } from "../../src/localEngine/core/engineRunner.js";

// Regression test for a bug where `buildKeyConcepts()` was missing its
// trailing blank line, so "## Potential Issues" ran directly onto the
// previous bullet with no blank line between them (breaking Markdown
// section separation, unlike every other section boundary).
test("Leaves a blank line between '## Key Concepts' and '## Potential Issues'", () => {
  const out = generateLocalExplanation(
    "function add(a, b) {\n  return a + b;\n}",
    "javascript"
  );
  assert.match(out, /## Key Concepts\n\n(?:.|\n)*?\n\n## Potential Issues/);
});
