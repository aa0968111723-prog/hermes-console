import test from "node:test";
import assert from "node:assert/strict";
import { taskPollDelayMs } from "../lib/client/task-poll";

test("idle workspace polls slower than an active task", () => {
  assert.equal(taskPollDelayMs(true), 3_000);
  assert.equal(taskPollDelayMs(false), 20_000);
});
