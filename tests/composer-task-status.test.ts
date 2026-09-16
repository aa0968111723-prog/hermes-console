import test from "node:test";
import assert from "node:assert/strict";
import type { Task, TaskEvent } from "../lib/contracts";
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

test("composer shows high-level progress, not tool names", () => {
  assert.deepEqual(composerTaskStatus(task("running"), false), {
    label: "正在研究", tone: "neutral", tool: null,
    toolName: null, toolKind: null,
  });
  for (const [state, label] of Object.entries({
    completed: "完成",
    failed: "失敗",
    uncertain: "結果待確認",
    waiting_user: "等待確認",
    stopping: "停止確認中",
    cancelled: "已取消",
    queued: "正在規劃",
  })) {
    const result = composerTaskStatus(task(state as Task["state"]), false);
    assert.equal(result.label, label);
    assert.equal(result.tool, null, "student pill never shows tool names");
  }
});

test("composer running progress follows activity kind, not technical identifiers", () => {
  for (const [name, label] of Object.entries({
    tamkang_lookup: "正在研究",
    instagram_search: "正在研究",
    pinterest_fetch: "正在研究",
    canva_create_design: "正在創作",
    workspace_get_visual_concepts: "正在創作",
    planform_layout: "進行中",
    xunhe_research: "正在研究",
    audience_twin: "正在模擬",
    console_workspace_context: "正在整理",
    hermes_web_search: "正在研究",
    untrusted_vendor_tool_9834: "進行中",
  })) {
    const value = task("running");
    value.events[0].toolName = name;
    const status = composerTaskStatus(value, false);
    assert.equal(status.label, label);
    assert.equal(status.tool, null);
    assert.equal(status.toolName, null);
  }
});

test("composer marks stale observations and offline data as unconfirmed", () => {
  assert.deepEqual(composerTaskStatus(task("running"), true), {
    label: OFFLINE_PILL_LABEL, tone: "warning", tool: null,
    toolName: null, toolKind: null,
  });
  assert.equal(OFFLINE_PILL_LABEL, "離線 · 顯示上次資料");
  assert.match(OFFLINE_NOTICE, /離線 · 顯示上次資料/);
  assert.deepEqual(composerTaskStatus(task("running", "poll failed"), false), {
    label: "連線異常 · 狀態待確認", tone: "warning", tool: null,
    toolName: null, toolKind: null,
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

test("shortTaskError hides long stacks", () => {
  const stacked = "upstream timeout\n    at runTask (/app/lib/server/tasks.ts:1:1)\n    at processTicks";
  assert.equal(shortTaskError(stacked), "upstream timeout");
  assert.equal(shortTaskError("x".repeat(300))?.endsWith("…"), true);
  assert.equal(shortTaskError(""), null);
  assert.equal(shortTaskError(null), null);
});
