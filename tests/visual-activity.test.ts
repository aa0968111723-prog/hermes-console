import test from "node:test";
import assert from "node:assert/strict";
import { activityKind, eventStateLabel, highLevelProgress, safeSource, toolDisplayLabel, workingEvent } from "../lib/client/activity";
import type { Task, TaskEvent } from "../lib/contracts";
const event = (
  id: string,
  status: string,
  tool = "galley_research",
  call = "call-1",
) => ({ id, status, toolName: tool, toolCallId: call }) as TaskEvent;
const task = (state: Task["state"], events: TaskEvent[]) =>
  ({ state, events }) as Task;

test("visual progress requires actual active tool evidence", () => {
  assert.equal(workingEvent(task("running", [])), undefined);
  const start = event("start", "tool.running");
  assert.equal(workingEvent(task("running", [start])), start);
  for (const state of [
    "completed",
    "failed",
    "cancelled",
    "uncertain",
    "stopping",
    "waiting_user",
  ] as const)
    assert.equal(workingEvent(task(state, [start])), undefined);
  for (const state of ["completed", "failed", "cancelled", "uncertain"])
    assert.equal(
      workingEvent(task("running", [start, event("end", state)])),
      undefined,
    );
});
test("event states use concise user-facing labels", () => {
  for (const [status, label] of Object.entries({
    "tool.running": "執行中",
    queued: "排隊",
    waiting_authorization: "等待授權",
    waiting_user: "等待確認",
    completed: "完成",
    failed: "失敗",
    uncertain: "結果待確認",
    cancelled: "已取消",
    unexpected: "狀態未知",
  })) assert.equal(eventStateLabel(event("state", status)), label);
});
test("sequential and concurrent calls track IDs, not just tool names", () => {
  const first = event("1", "running"),
    second = event("2", "running", "galley_research", "call-2");
  assert.equal(
    workingEvent(
      task("running", [
        first,
        second,
        event("3", "completed", "galley_research", "call-2"),
      ]),
    ),
    first,
  );
  assert.equal(activityKind("galley_research"), "research");
  assert.equal(activityKind("canva_create_design"), "creative");
  assert.equal(activityKind("workspace_get_visual_concepts"), "creative");
  assert.equal(activityKind("workspace_search_inspiration"), "research");
  assert.equal(toolDisplayLabel("workspace_search_inspiration"), "靈感 · 參考");
  assert.equal(activityKind("workspace_read_material"), "request");
  assert.equal(toolDisplayLabel("workspace_read_material"), "畫面 · 讀取");
  assert.equal(activityKind("unrecognized_tool"), "tool");
});
test("chat progress is high-level stages, not tool counts", () => {
  const running = highLevelProgress(
    task("running", [event("1", "running", "galley_research")]),
  );
  assert.equal(running.label, "正在研究");
  assert.equal(running.stages[0]?.label, "研究");
  assert.equal(running.stages[0]?.state, "active");
  assert.doesNotMatch(running.label, /工具|galley|toolCall/i);
  const done = highLevelProgress(
    task("completed", [
      event("1", "completed", "galley_research"),
      event("2", "completed", "canva_create_design", "call-2"),
    ]),
  );
  assert.equal(done.label, "完成");
  assert.deepEqual(
    done.stages.map((stage) => stage.label),
    ["研究", "創作"],
  );
});
test("source actions never accept script, credentials or relative destinations", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//private",
    "https://user:secret@example.com",
    "file:///secret",
  ])
    assert.equal(safeSource(value), null);
  assert.equal(
    safeSource("https://example.com/source"),
    "https://example.com/source",
  );
});
