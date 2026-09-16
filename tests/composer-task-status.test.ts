import test from "node:test";
import assert from "node:assert/strict";
import { DESIGN_WITHOUT_PREVIEW, type Task, type TaskEvent } from "../lib/contracts";
import {
  OFFLINE_NOTICE,
  OFFLINE_PILL_LABEL,
  composerTaskPillAction,
  composerTaskStatus,
  recoveryOnReconnectAction,
  shortTaskError,
} from "../components/visual/ComposerTaskStatus";

const task = (state: Task["state"], observationError: string | null = null) => ({
  state, observationError,
  events: [{ toolCallId: "tool-1", toolName: "galley_research", status: "running" } as TaskEvent],
}) as Task;

test("composer exposes observed task state and only active tool evidence", () => {
  assert.deepEqual(composerTaskStatus(task("running"), false), {
    label: "執行中", tone: "neutral", tool: "研究",
    toolName: "galley_research", toolKind: "research",
  });
  for (const [state, label] of Object.entries({ completed: "完成", failed: "失敗", uncertain: "結果待確認", waiting_user: "等待確認", stopping: "停止確認中", cancelled: "已取消" })) {
    const result = composerTaskStatus(task(state as Task["state"]), false);
    assert.equal(result.label, label);
    assert.equal(result.tool, null, "terminal/waiting states cannot show stale running tools");
  }
});

test("composer shows student phases, not vendor tool names", () => {
  for (const [name, label] of Object.entries({
    tamkang_lookup: "研究",
    instagram_search: "靈感",
    pinterest_fetch: "靈感",
    canva_create_design: "創作",
    workspace_get_visual_concepts: "創作",
    planform_layout: "創作",
    xunhe_research: "研究",
    audience_twin: "客群",
    console_workspace_context: "理解",
    hermes_web_search: "研究",
    untrusted_vendor_tool_9834: "工具",
  })) {
    const value = task("running");
    value.events[0].toolName = name;
    const status = composerTaskStatus(value, false);
    assert.equal(status.tool, label);
    assert.equal(status.toolName, name);
  }
});

test("composer marks stale observations and offline data as unconfirmed", () => {
  assert.deepEqual(composerTaskStatus(task("running"), true), {
    label: OFFLINE_PILL_LABEL, tone: "warning", tool: null,
  });
  assert.equal(OFFLINE_PILL_LABEL, "離線 · 顯示上次資料");
  assert.match(OFFLINE_NOTICE, /離線 · 顯示上次資料/);
  assert.deepEqual(composerTaskStatus(task("running", "poll failed"), false), {
    label: "連線異常 · 狀態待確認", tone: "warning", tool: null,
  });
  assert.equal(composerTaskStatus(task("unexpected" as Task["state"]), false).label, "狀態未知");
});

test("uncertain and offline never auto-resend or auto-acknowledge via pill action", () => {
  assert.equal(composerTaskPillAction(true), "refresh");
  assert.equal(composerTaskPillAction(false), "open_sheet");
  assert.equal(recoveryOnReconnectAction(), "refresh_only");
  // Explicit contract: reconnect/offline paths expose refresh_only / refresh —
  // never "resend" or "acknowledge". Keep the enum closed.
  assert.notEqual(composerTaskPillAction(true), "open_sheet");
  assert.notEqual(recoveryOnReconnectAction() as string, "resend");
  assert.notEqual(recoveryOnReconnectAction() as string, "acknowledge");
});

test("spec-only design completion is a warning, not a green check", () => {
  const spec = task("completed");
  spec.events = [
    {
      toolCallId: "tool-1",
      toolName: "workspace_get_visual_concepts",
      status: "completed",
      summary: DESIGN_WITHOUT_PREVIEW,
    } as TaskEvent,
  ];
  spec.goal = { requiresDesign: true } as Task["goal"];
  assert.deepEqual(composerTaskStatus(spec, false), {
    label: "規格已保留",
    tone: "warning",
    tool: null,
    toolName: null,
    toolKind: null,
  });
  assert.notEqual(composerTaskStatus(task("completed"), false).tone, "warning");
  assert.equal(composerTaskStatus(task("completed"), false).label, "完成");
  const failedWithMark = task("failed");
  failedWithMark.events[0].summary = DESIGN_WITHOUT_PREVIEW;
  assert.equal(composerTaskStatus(failedWithMark, false).label, "失敗");
  assert.equal(composerTaskStatus(failedWithMark, false).tone, "error");
});

test("shortTaskError hides long stacks", () => {
  const stacked = "upstream timeout\n    at runTask (/app/lib/server/tasks.ts:1:1)\n    at processTicks";
  assert.equal(shortTaskError(stacked), "upstream timeout");
  assert.equal(
    shortTaskError("Hermes 金鑰無效或已撤銷，請在後端更換。"),
    "現在沒辦法連到 Hermes。",
  );
  assert.equal(shortTaskError("x".repeat(300))?.endsWith("…"), true);
  assert.equal(shortTaskError(""), null);
  assert.equal(shortTaskError(null), null);
});
