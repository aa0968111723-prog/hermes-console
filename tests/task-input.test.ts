import assert from "node:assert/strict";
import test from "node:test";
import { presentTaskInput } from "../lib/client/task-input";

test("short request remains complete", () => {
  assert.deepEqual(presentTaskInput("研究春日活動參考"), {
    preview: "研究春日活動參考",
    truncated: false,
  });
});

test("long CJK request is bounded without losing the original contract", () => {
  const input = "請研究淡江春日活動並整理來源。".repeat(20);
  const result = presentTaskInput(input);
  assert.equal(result.truncated, true);
  assert.ok(result.preview.endsWith("…"));
  assert.ok(result.preview.length <= 141);
  assert.equal(input.length > result.preview.length, true);
});

test("preview removes layout-heavy whitespace and prefers a word boundary", () => {
  const result = presentTaskInput(
    "first     second\nthird " + "detail ".repeat(40),
    40,
  );
  assert.equal(result.truncated, true);
  assert.equal(result.preview.includes("\n"), false);
  assert.equal(result.preview.includes("  "), false);
  assert.ok(result.preview.endsWith("…"));
});
