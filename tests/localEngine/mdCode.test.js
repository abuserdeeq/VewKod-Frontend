import test from "node:test";
import assert from "node:assert/strict";
import { mdCode } from "../../src/localEngine/shared/patterns.js";

test("mdCode: plain text uses a normal single-backtick span", () => {
  assert.equal(mdCode("hello"), "`hello`");
});

test("mdCode: a value containing one backtick gets a double-backtick fence", () => {
  assert.equal(mdCode("await fetch(`/x/${id}`)"), "``await fetch(`/x/${id}`)``");
});

test("mdCode: a value that itself starts/ends with a backtick gets padding spaces", () => {
  assert.equal(mdCode("`already wrapped`"), "`` `already wrapped` ``");
});

test("mdCode: a value with a run of two backticks gets a triple-backtick fence", () => {
  const value = "some `` odd text";
  const result = mdCode(value);
  assert.equal(result, "```some `` odd text```");
});
