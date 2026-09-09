import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_USAGE, type TaskState } from "../lib/contracts";
import { presentTaskUsage } from "../lib/client/task-usage";

function task(state: TaskState, usage = EMPTY_USAGE) {
  return { state, usage };
}

test("active task without metrics waits without inventing zeroes", () => {
  assert.deepEqual(presentTaskUsage(task("running")), {
    state: "waiting",
    summary: "等待 Hermes 回傳",
    highlights: [],
    details: [],
  });
});

test("settled task without metrics reports one honest missing state", () => {
  const result = presentTaskUsage(task("completed"));
  assert.equal(result.state, "missing");
  assert.equal(result.summary, "未回傳用量資料");
  assert.equal(result.highlights.length, 0);
  assert.equal(result.details.length, 0);
});

test("partial usage only exposes fields Hermes actually returned", () => {
  const result = presentTaskUsage(
    task("completed", {
      ...EMPTY_USAGE,
      model: "Hermes-3",
      totalTokens: 1234,
      inputTokens: 1000,
      durationMs: 1650,
      toolCost: 0,
    }),
  );
  assert.equal(result.state, "available");
  assert.equal(result.summary, "已回傳 5 項");
  assert.deepEqual(
    result.highlights.map(({ label, value }) => [label, value]),
    [
      ["模型", "Hermes-3"],
      ["總 tokens", "1,234"],
      ["耗時", "1.6 秒"],
    ],
  );
  assert.deepEqual(
    result.details.map(({ label, value }) => [label, value]),
    [
      ["輸入 tokens", "1,000"],
      ["外部工具費用", "0"],
    ],
  );
});

test("input and output remain visible when total tokens are absent", () => {
  const result = presentTaskUsage(
    task("failed", {
      ...EMPTY_USAGE,
      inputTokens: 25,
      outputTokens: 7,
    }),
  );
  assert.deepEqual(
    result.highlights.map(({ label }) => label),
    ["輸入 tokens", "輸出 tokens"],
  );
  assert.equal(result.details.length, 0);
});
