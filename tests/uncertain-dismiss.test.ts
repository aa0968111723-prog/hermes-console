import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// LOCAL_CONTRACT only. No Hermes fixture server is needed: dismissal of a
// chat-transport uncertain task must not touch the network at all, and must
// unblock its conversation for a new submission.
process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-dismiss-escape-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3233";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.HERMES_API_KEY = randomBytes(24).toString("hex");
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.HERMES_API_URL = "http://127.0.0.1:1";
process.env.HERMES_CONNECT_TIMEOUT_MS = "500";
process.env.HERMES_IDLE_TIMEOUT_MS = "300";

const { put } = await import("../lib/server/store");
const { dismiss, submit, taskFor } = await import("../lib/server/tasks");

function uncertainChatTask(conversationId: string) {
  const id = randomUUID();
  const createdAt = new Date(Date.now() - 1000).toISOString();
  put("task", "owner", {
    id,
    conversationId,
    requestKey: randomUUID(),
    payloadHash: randomUUID(),
    state: "uncertain",
    transport: "chat",
    remoteId: null,
    input: "中斷前的提問",
    attachments: [],
    output: "半段回覆",
    createdAt,
    updatedAt: createdAt,
    endedAt: createdAt,
    error: "串流中斷，尚未收到完成訊號；上游結果待確認。",
    observationError: null,
    events: [],
    usage: {
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      model: null,
      durationMs: 1000,
    },
    stopSupported: false,
    budgetMode: "balanced",
  });
  return id;
}

test("dismiss unblocks the conversation and keeps the record", async () => {
  const conversationId = randomUUID();
  put("conversation", "owner", {
    id: conversationId,
    title: "解除鎖定契約",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const id = uncertainChatTask(conversationId);

  // Non-uncertain tasks are not dismissable: seed a completed sibling.
  const siblingId = randomUUID();
  put("task", "owner", { ...taskFor("owner", id), id: siblingId, state: "completed" });
  await assert.rejects(() => dismiss("owner", siblingId), /解除鎖定/);

  const released = await dismiss("owner", id);
  assert.equal(released.state, "cancelled");
  assert.ok(released.endedAt);
  assert.ok(
    released.events.some((item) => item.summary.includes("解除鎖定")),
    "dismissal leaves an audit event",
  );
  // Full record is preserved for the operations log.
  assert.equal(taskFor("owner", id).input, "中斷前的提問");
  assert.equal(taskFor("owner", id).output, "半段回覆");

  // The busy guard must no longer be the blocker: with Hermes unreachable,
  // submit must now fail on readiness (hermes_not_ready), not on a busy
  // conversation. Assert the ApiError code directly.
  const failure = await submit("owner", {
    conversationId,
    requestKey: randomUUID(),
    input: "解除後的新提問",
    attachments: [],
  }).then(
    () => null,
    (error: unknown) => error as { code?: string },
  );
  assert.equal(failure?.code, "hermes_not_ready");
});
