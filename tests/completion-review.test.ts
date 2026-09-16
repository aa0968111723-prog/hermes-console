import test from "node:test";
import assert from "node:assert/strict";
import { completionNotice } from "../lib/server/orchestrator/review";
import { EMPTY_USAGE, type Task } from "../lib/contracts";

function task(events: Task["events"]): Task {
  return {
    id: "t",
    conversationId: "c",
    requestKey: "r",
    payloadHash: "h",
    state: "completed",
    transport: "chat",
    remoteId: null,
    input: "x",
    attachments: [],
    output: "已整理可確認的結果。",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    error: null,
    observationError: null,
    events,
    usage: { ...EMPTY_USAGE },
    stopSupported: false,
  };
}

test("completion notice is user-facing and hides tool internals", () => {
  assert.equal(completionNotice(task([])), null);
  const notice = completionNotice(
    task([
      {
        id: "e",
        taskId: "t",
        kind: "tool",
        toolName: "tamkang_mcp",
        status: "failed",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        summary: "x",
        result: null,
        sources: [],
        error: "timeout",
        usage: null,
      },
    ]),
  );
  assert.equal(notice, "有工具沒有完成，沒有用猜測補上結果。");
  assert.doesNotMatch(notice || "", /tamkang_mcp|timeout|endpoint/);
  const unread = task([]);
  unread.goal = {
    goal: "這張哪裡可以改？",
    audience: null,
    output: null,
    constraints: [],
    requiresResearch: false,
    requiresDesign: false,
    requiresAudienceEvaluation: false,
    requiresTamkang: false,
    requiresInspiration: false,
    requiresImageRead: true,
    requiresLumen: false,
    targetRevision: null,
    intentTier: "create",
  };
  assert.equal(
    completionNotice(unread),
    "尚未讀取上傳素材，沒有把檔名當成已看過的圖。",
  );
});
