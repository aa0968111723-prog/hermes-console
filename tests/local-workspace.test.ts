import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { seedSession } from "./session-fixture";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-local-ws-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3344";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;
seedSession();

const { localWorkspaceReply } = await import("../lib/server/local-workspace");
const { put } = await import("../lib/server/store");
const { submit } = await import("../lib/server/tasks");
const { ApiError } = await import("../lib/server/security");

test("club queries return indexed snapshot, not fake GALLEY or Hermes", () => {
  const text = localWorkspaceReply("幫我找淡大禪學社茶會宣傳靈感");
  assert.ok(text);
  assert.match(text, /Hermes Agent 尚未連線/);
  assert.match(text, /Drive 快照|不是即時/);
  assert.doesNotMatch(text, /GALLEY 已/);
  assert.doesNotMatch(text, /已搜尋整個 Instagram/);
  assert.ok(/茶會|UNKNOWN|期初/.test(text));
});

test("generic chat without Hermes still fails closed", () => {
  assert.equal(localWorkspaceReply("你好"), null);
  assert.equal(localWorkspaceReply("幫我算 1+1"), null);
});

test("unconfigured Hermes still answers club questions from local index", async () => {
  const conv = put("conversation", "workspace", {
    id: randomUUID(),
    title: "本地索引",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const task = await submit("workspace", {
    conversationId: conv.id,
    requestKey: randomUUID(),
    input: "幫我找淡大禪學社茶會宣傳靈感",
    attachments: [],
  });
  assert.equal(task.state, "completed");
  assert.equal(task.remoteId, null);
  assert.match(task.output, /尚未連線/);
  assert.equal(task.stopSupported, false);
  assert.ok(task.events.some((event) => event.toolName === "zenclub_drive_index"));
});

test("unconfigured Hermes rejects unrelated prompts", async () => {
  const conv = put("conversation", "workspace", {
    id: randomUUID(),
    title: "閒聊",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await assert.rejects(
    () =>
      submit("workspace", {
        conversationId: conv.id,
        requestKey: randomUUID(),
        input: "你好",
        attachments: [],
      }),
    (error: unknown) =>
      error instanceof ApiError && error.code === "hermes_not_ready",
  );
});
