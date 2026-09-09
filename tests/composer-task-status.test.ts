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
    label: "執行中", tone: "neutral", tool: "研究 · GALLEY",
    toolName: "galley_research", toolKind: "research",
  });
  for (const [state, label] of Object.entries({ completed: "完成", failed: "失敗", uncertain: "結果待確認", waiting_user: "等待確認", stopping: "停止確認中", cancelled: "已取消" })) {
    const result = composerTaskStatus(task(state as Task["state"]), false);
    assert.equal(result.label, label);
    assert.equal(result.tool, null, "terminal/waiting states cannot show stale running tools");
  }
});

test("composer translates known tools and hides unknown technical identifiers", () => {
  for (const [name, label] of Object.entries({
    tamkang_lookup: "查詢 · 淡江",
    instagram_search: "參考 · Instagram",
    pinterest_fetch: "參考 · Pinterest",
    canva_create_design: "創作 · Canva",
    workspace_get_visual_concepts: "視覺 · 概念規格",
    planform_layout: "場佈 · Planform",
    xunhe_research: "研究 · 訊核",
    audience_twin: "模擬 · 目標客群",
    console_workspace_context: "整理 · 工作區",
    hermes_web_search: "搜尋 · 網路",
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
    label: "離線 · 狀態待確認", tone: "warning", tool: null,
  });
  assert.deepEqual(composerTaskStatus(task("running", "poll failed"), false), {
    label: "連線異常 · 狀態待確認", tone: "warning", tool: null,
  });
  assert.equal(composerTaskStatus(task("unexpected" as Task["state"]), false).label, "狀態未知");
});
