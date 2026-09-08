import test from "node:test";
import assert from "node:assert/strict";
import type { Task, TaskEvent } from "../lib/contracts";
import { composerTaskStatus } from "../components/visual/ComposerTaskStatus";

const task = (state: Task["state"], observationError: string | null = null) => ({
  state, observationError,
  events: [{ toolCallId: "tool-1", toolName: "galley_research", status: "running" } as TaskEvent],
}) as Task;

test("composer exposes observed task state and only active tool evidence", () => {
  assert.deepEqual(composerTaskStatus(task("running"), false), {
    label: "執行中", tone: "neutral", tool: "galley_research",
  });
  for (const [state, label] of Object.entries({ completed: "完成", failed: "失敗", uncertain: "結果待確認", waiting_user: "等待確認", stopping: "停止確認中", cancelled: "已取消" })) {
    const result = composerTaskStatus(task(state as Task["state"]), false);
    assert.equal(result.label, label);
    assert.equal(result.tool, null, "terminal/waiting states cannot show stale running tools");
  }
});

test("composer marks stale observations and offline data as unconfirmed", () => {
  assert.deepEqual(composerTaskStatus(task("running"), true), {
    label: "離線 · 狀態待確認", tone: "warning", tool: null,
  });
  assert.deepEqual(composerTaskStatus(task("running", "poll failed"), false), {
    label: "連線異常 · 狀態待確認", tone: "warning", tool: null,
  });
  assert.equal(composerTaskStatus(task("unexpected" as Task["state"]), false).label, "狀態未知");
});
