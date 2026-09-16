import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-workspace-inspiration-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3294";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.HERMES_API_URL = "";
process.env.HERMES_API_KEY = "";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";

const { submit } = await import("../lib/server/tasks");
const { put, get } = await import("../lib/server/store");
const { ApiError } = await import("../lib/server/errors");
const { isInspirationSearchPack, directionPickFollowUp } = await import(
  "../lib/inspiration-pack"
);
const { health } = await import("../lib/server/hermes");
const { selectInspirationDirection } = await import(
  "../lib/server/inspiration/engine"
);
const { listArtifacts } = await import("../lib/server/artifacts");
const { listWorkflows } = await import("../lib/server/workflows");

const TEA = "幫我找淡大禪學社茶會宣傳靈感";

function conv() {
  const id = randomUUID();
  put("conversation", "workspace", {
    id,
    title: "工作區靈感契約",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

test("unconfigured Hermes still returns workspace inspiration directions", async () => {
  const connection = await health("workspace", true);
  assert.notEqual(connection.credential, "valid");
  const conversationId = conv();
  const requestKey = randomUUID();
  const task = await submit("workspace", {
    conversationId,
    requestKey,
    input: TEA,
    attachments: [],
  });
  assert.equal(task.state, "completed");
  assert.equal(task.transport, "chat");
  assert.equal(task.remoteId, null);
  assert.equal(task.stopSupported, false);
  assert.equal(task.goal?.requiresInspiration, true);
  assert.match(task.output, /不是 Hermes Agent 執行/);
  assert.match(task.output, /沒有搜尋整個 Instagram/);
  assert.match(task.output, /沒有連到淡江資料源/);
  assert.doesNotMatch(task.output, /已搜尋整個 Instagram/);
  const tool = task.events.find(
    (event) => event.toolName === "workspace_search_inspiration",
  );
  assert.ok(tool);
  assert.equal(tool?.status, "completed");
  assert.equal(isInspirationSearchPack(tool?.result), true);
  const pack = tool?.result as { directions: Array<{ id: string }> };
  assert.ok(pack.directions.some((item) => item.id === "A"));
  assert.equal(get("agent", "workspace", "verified"), null);
  const stored = get<{
    messages: Array<{
      role: string;
      provenance?: string;
      taskId?: string;
      content: string;
    }>;
  }>("conversation", "workspace", conversationId);
  const assistant = stored?.messages.filter((item) => item.role === "assistant");
  assert.equal(assistant?.length, 1);
  assert.equal(assistant?.[0].provenance, "workspace");
  assert.equal(assistant?.[0].taskId, task.id);
  assert.match(assistant?.[0].content || "", /不是 Hermes Agent 執行/);
  const again = await submit("workspace", {
    conversationId,
    requestKey,
    input: TEA,
    attachments: [],
  });
  assert.equal(again.id, task.id);
  assert.equal(
    stored &&
      get<{ messages: unknown[] }>("conversation", "workspace", conversationId)
        ?.messages.filter((item) => (item as { role: string }).role === "assistant")
        .length,
    1,
  );
});

test("non-inspiration chat still refuses when Hermes is unconfigured", async () => {
  await assert.rejects(
    () =>
      submit("workspace", {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: "只是打個招呼，今天好嗎",
        attachments: [],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "hermes_not_ready");
      return true;
    },
  );
  await assert.rejects(
    () =>
      submit("workspace", {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: directionPickFollowUp("A", "淡大禪學社茶會・手搖飲場景"),
        attachments: [],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "hermes_not_ready");
      return true;
    },
  );
  assert.equal(get("agent", "workspace", "verified"), null);
});

test("unconfigured Hermes revises the same spec when asked to enlarge type", async () => {
  const conversationId = conv();
  await submit("workspace", {
    conversationId,
    requestKey: randomUUID(),
    input: TEA,
    attachments: [],
  });
  const picked = selectInspirationDirection({
    owner: "workspace",
    prompt: TEA,
    projectId: "personal",
    selected: "A",
    conversationId,
  });
  assert.equal(picked.workflow.directionBrief?.revision, 1);
  const revised = await submit("workspace", {
    conversationId,
    requestKey: randomUUID(),
    input: "第二版字放大",
    attachments: [],
  });
  assert.equal(revised.state, "completed");
  assert.match(revised.output, /規則修訂/);
  assert.match(revised.output, /不是已出圖/);
  assert.match(revised.output, /不是 Canva/);
  const assistant = get<{
    messages: Array<{ provenance?: string; taskId?: string }>;
  }>("conversation", "workspace", conversationId)?.messages.filter(
    (item) => item.taskId === revised.id,
  );
  assert.equal(
    assistant?.some((item) => item.provenance === "workspace"),
    true,
  );
  const workflow = listWorkflows("workspace").find(
    (item) => item.conversationId === conversationId,
  );
  assert.equal(workflow?.artifactId, picked.workflow.artifactId);
  assert.equal(workflow?.directionBrief?.revision, 2);
  assert.match(workflow?.directionBrief?.visualNote || "", /主標加大/);
  assert.equal(workflow?.directionBrief?.rendered, false);
  assert.equal(workflow?.directionBrief?.hermesGenerated, false);
  const artifact = listArtifacts("workspace", "personal").find(
    (item) => item.id === workflow?.artifactId,
  );
  assert.equal(artifact?.source, "workspace");
  assert.equal(artifact?.revisions.length, 2);
  assert.equal(get("agent", "workspace", "verified"), null);
});
