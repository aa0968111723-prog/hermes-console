import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { seedSession } from "./session-fixture";
import type { Conversation } from "../lib/contracts";
import { parseVisualConceptPack } from "../lib/client/visual-pack";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-local-ws-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3344";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;
seedSession();

const { localWorkspaceReply } = await import("../lib/server/local-workspace");
const { get, put } = await import("../lib/server/store");
const { submit } = await import("../lib/server/tasks");
const { ApiError } = await import("../lib/server/security");

test("club inspiration returns visual cards with overlay date, not a notes wall", () => {
  const text = localWorkspaceReply("幫我找淡大禪學社茶會宣傳靈感");
  assert.ok(text);
  const pack = parseVisualConceptPack(text);
  assert.ok(pack);
  assert.equal(pack.generatedImage, false);
  assert.equal(pack.rendered, false);
  assert.equal(pack.publish, false);
  assert.equal(pack.overlayText?.date, "2026-09-30");
  assert.equal(pack.overlayText?.location, null);
  assert.ok(pack.unknownFields.includes("地點"));
  assert.match(pack.notice, /Hermes Agent 尚未連線/);
  assert.match(pack.notice, /Drive 快照|不是即時/);
  assert.equal(pack.concepts.length, 3);
  assert.equal(pack.captions?.A?.cta, "報名");
  assert.match(pack.captions?.A?.body || "", /2026-09-30/);
  assert.match(pack.captions?.A?.body || "", /19:00-21:30/);
  assert.doesNotMatch(pack.captions?.A?.body || "", /宮燈|文館左側/);
  assert.doesNotMatch(pack.captions?.A?.hook || "", /已出圖/);
  assert.doesNotMatch(text, / · place：/);
  assert.doesNotMatch(text, /索引沒有命中/);
  assert.doesNotMatch(text, /GALLEY 已/);
  assert.doesNotMatch(text, /已搜尋整個 Instagram/);
  assert.doesNotMatch(text, /Inspiration Engine/);
});

test("factual club query stays a short card, not a visual pack", () => {
  const text = localWorkspaceReply("禪學社期初茶會地點");
  assert.ok(text);
  assert.equal(parseVisualConceptPack(text), null);
  assert.match(text, /尚未連線/);
  assert.match(text, /2026-09-30/);
  assert.match(text, /地點：UNKNOWN/);
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
  const pack = parseVisualConceptPack(task.output);
  assert.ok(pack);
  assert.equal(pack.overlayText?.date, "2026-09-30");
  assert.equal(pack.overlayText?.location, null);
  assert.match(pack.notice, /尚未連線/);
  assert.match(pack.workflowId || "", /^[a-f0-9]{64}$/);
  const { workflow, chooseDirection, listWorkflows } = await import(
    "../lib/server/workflows"
  );
  const saved = workflow("workspace", pack.workflowId!);
  assert.equal(saved.selected, null);
  assert.equal(saved.state, "awaiting_selection");
  assert.equal(saved.design, null);
  assert.equal(chooseDirection("workspace", saved.id, 0).selected, 0);
  assert.equal(listWorkflows("workspace").some((item) => item.id === saved.id), true);
  assert.equal(task.stopSupported, false);
  assert.ok(task.events.some((event) => event.toolName === "zenclub_drive_index"));
  const stored = get<Conversation>("conversation", "workspace", conv.id);
  assert.ok(stored);
  const assistants = stored.messages.filter((m) => m.role === "assistant");
  assert.equal(assistants.length, 1);
  assert.equal(assistants[0].taskId, task.id);
  assert.equal(assistants[0].content, task.output);
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
