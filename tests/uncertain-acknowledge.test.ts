import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * LOCAL_CONTRACT — acknowledge uncertain task unblocks conversation for retry.
 * Not LIVE_EXTERNAL.
 */
process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-uncertain-ack-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3213";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";

const { put } = await import("../lib/server/store");
const { taskFor } = await import("../lib/server/tasks");
const { acknowledge } = await import("../lib/server/task-acknowledge");
const { ApiError } = await import("../lib/server/security");

function seedUncertain() {
  const id = randomUUID();
  const conversationId = randomUUID();
  put("conversation", "owner", {
    id: conversationId,
    title: "待確認契約",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  put("task", "owner", {
    id,
    conversationId,
    requestKey: randomUUID(),
    payloadHash: "x",
    state: "uncertain",
    transport: "chat",
    remoteId: null,
    input: "中斷後重試契約",
    attachments: [],
    output: "半段",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    error: "串流中斷，尚未收到完成訊號；上游結果待確認。",
    observationError: null,
    events: [],
    usage: {
      model: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      durationMs: null,
      providerCost: null,
      toolCost: null,
    },
    stopSupported: false,
  });
  return id;
}

test("acknowledge moves uncertain to cancelled so conversation can retry", () => {
  const id = seedUncertain();
  const before = taskFor("owner", id);
  assert.equal(before.state, "uncertain");
  const after = acknowledge("owner", id);
  assert.equal(after.state, "cancelled");
  assert.match(after.error || "", /已確認|重新提交/);
  assert.ok(after.endedAt);
});

test("acknowledge rejects non-uncertain tasks", () => {
  const id = randomUUID();
  put("task", "owner", {
    id,
    conversationId: randomUUID(),
    requestKey: randomUUID(),
    payloadHash: "y",
    state: "completed",
    transport: "chat",
    remoteId: null,
    input: "已完成",
    attachments: [],
    output: "ok",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    error: null,
    observationError: null,
    events: [],
    usage: {
      model: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      durationMs: null,
      providerCost: null,
      toolCost: null,
    },
    stopSupported: false,
  });
  assert.throws(
    () => acknowledge("owner", id),
    (err: unknown) =>
      err instanceof ApiError &&
      err.code === "not_uncertain" &&
      err.status === 409,
  );
});
