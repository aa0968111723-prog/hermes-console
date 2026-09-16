import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Task, TaskEvent } from "../lib/contracts";
import { EMPTY_USAGE } from "../lib/contracts";
import { ApiError } from "../lib/server/errors";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-empty-tool-result-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3271";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";

const {
  isEmptyToolResult,
  assertMeaningfulToolResult,
  toolEventHasUsableOutput,
} = await import("../lib/server/tool-result");
const { errorCategory } = await import("../lib/server/errors");
const { classifyResume, resumeNotice } = await import(
  "../lib/server/orchestrator/recovery"
);
const { put } = await import("../lib/server/store");
const { hasCompletedToolEvents, taskFor } = await import("../lib/server/tasks");
const { reconcileActiveTasks } = await import("../lib/server/monitor");
const { callTool } = await import("../lib/server/mcp");

function fakeEvent(partial: Partial<TaskEvent>): TaskEvent {
  return {
    id: randomUUID(),
    taskId: "t",
    toolName: null,
    status: "queued",
    startedAt: new Date().toISOString(),
    endedAt: null,
    summary: "x",
    result: null,
    sources: [],
    error: null,
    usage: null,
    ...partial,
  };
}

test("empty HTTP 200 payloads are not success", () => {
  assert.equal(isEmptyToolResult({}), true);
  assert.equal(isEmptyToolResult({ text: "" }), true);
  assert.equal(isEmptyToolResult({ content: "   " }), true);
  assert.equal(isEmptyToolResult({ result: {} }), true);
  assert.equal(isEmptyToolResult(null), true);
  assert.equal(isEmptyToolResult(""), true);
  assert.equal(isEmptyToolResult({ hits: [] }), false);
  assert.equal(isEmptyToolResult({ memories: [], notice: "僅此 scope" }), false);
  assert.equal(isEmptyToolResult({ ok: true }), false);
  assert.equal(isEmptyToolResult({ deleted: true, id: randomUUID() }), false);
  assert.throws(
    () => assertMeaningfulToolResult({}),
    (error: unknown) =>
      error instanceof ApiError && error.code === "empty_tool_result",
  );
  assert.doesNotThrow(() =>
    assertMeaningfulToolResult({}, "iVBORw0KGgo="),
  );
});

test("completed tool events with empty payloads do not count as success", () => {
  const empty: Task = {
    id: "a",
    conversationId: "c",
    requestKey: "k",
    payloadHash: "h",
    state: "running",
    transport: "chat",
    remoteId: null,
    input: "x",
    attachments: [],
    output: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: null,
    error: null,
    observationError: null,
    events: [
      fakeEvent({
        kind: "tool",
        toolName: "galley_research",
        status: "completed",
        summary: "工具已回傳結果；非同步工作需再查回，不等於製作已完成。",
        result: {},
      }),
    ],
    usage: { ...EMPTY_USAGE },
    stopSupported: false,
  };
  assert.equal(toolEventHasUsableOutput(empty.events[0]), false);
  assert.equal(hasCompletedToolEvents(empty), false);
  const preview = {
    ...empty,
    events: [
      fakeEvent({
        kind: "tool",
        toolName: "workspace_save_memory",
        status: "completed",
        summary: "已寫入共用記憶。",
        result: null,
      }),
    ],
  };
  assert.equal(hasCompletedToolEvents(preview), true);
});

test("empty_tool_result is UPSTREAM_ERROR", () => {
  assert.equal(errorCategory("empty_tool_result"), "UPSTREAM_ERROR");
  assert.equal(errorCategory("empty_output"), "UPSTREAM_ERROR");
  assert.equal(errorCategory("empty_stream"), "UPSTREAM_ERROR");
});

test("workspace search with no hits is a structured empty list, not a failed tool", async () => {
  const result = await callTool("workspace", "workspace_search_research_notes", {
    query: "ZZZ_NO_SUCH_RESEARCH_NOTE_TOKEN",
  });
  assert.equal(result.isError, false);
  const text = result.content?.[0]?.text || "";
  assert.match(text, /hits/);
});

test("classifyResume treats a live worker as running, dead worker as unknown", () => {
  const task = {
    id: "t",
    conversationId: "c",
    requestKey: "r",
    payloadHash: "h",
    state: "running",
    transport: "chat",
    remoteId: null,
    input: "x",
    attachments: [],
    output: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: null,
    error: null,
    observationError: null,
    events: [],
    usage: { ...EMPTY_USAGE },
    stopSupported: false,
  } as Task;
  assert.equal(classifyResume(task, true), "running");
  assert.equal(classifyResume(task, false), "unknown");
  assert.match(resumeNotice("unknown"), /尚未確認/);
  const submitting = { ...task, transport: "runs" as const, remoteId: null };
  assert.equal(classifyResume(submitting, true), "running");
  assert.equal(classifyResume(submitting, false), "unknown");
  const remote = { ...task, transport: "runs" as const, remoteId: "run_1" };
  assert.equal(classifyResume(remote, false), "running");
});

test("startup reconcile marks orphaned chat tasks uncertain immediately", async () => {
  const conversationId = randomUUID();
  const id = randomUUID();
  put("conversation", "workspace", {
    id: conversationId,
    title: "中斷任務",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  put("task", "workspace", {
    id,
    conversationId,
    requestKey: randomUUID(),
    payloadHash: "orphan",
    state: "running",
    transport: "chat",
    remoteId: null,
    input: "幫我做新生茶會海報",
    attachments: [],
    output: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: null,
    error: null,
    observationError: null,
    events: [],
    usage: { ...EMPTY_USAGE },
    stopSupported: false,
  } satisfies Task);
  await reconcileActiveTasks();
  const recovered = taskFor("workspace", id);
  assert.equal(recovered.state, "uncertain");
  assert.match(recovered.error || "", /尚未確認/);
});
