import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

/**
 * LOCAL_CONTRACT — HTTP handler journey for stream-incomplete recovery.
 * Not LIVE_EXTERNAL. Mock Hermes only.
 *
 * Covers the path unit tests still miss:
 * POST /api/conversations → POST /api/tasks → uncertain → conversation_busy
 * → either PATCH acknowledge (same conversation retry)
 * or POST /api/conversations parentId+beforeMessageId (retry branch).
 */
process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-e2e-recovery-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3260";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
process.env.HERMES_API_KEY = randomBytes(24).toString("hex");
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.HERMES_CONNECT_TIMEOUT_MS = "1000";
process.env.HERMES_IDLE_TIMEOUT_MS = "2000";
delete process.env.CANVA_CLIENT_ID;
delete process.env.CANVA_CLIENT_SECRET;
delete process.env.INSTAGRAM_CLIENT_ID;
delete process.env.INSTAGRAM_CLIENT_SECRET;

type Mode = "partial_close" | "ok";
let mode: Mode = "ok";

const server = createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer " + process.env.HERMES_API_KEY) {
    res.writeHead(401).end();
    return;
  }
  for await (const _ of req) {
    /* drain */
  }
  if (req.url === "/v1/models") {
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ data: [{ id: "fixture-agent" }] }));
    return;
  }
  if (req.url === "/v1/capabilities") {
    res.end(
      JSON.stringify({
        object: "hermes.api_server.capabilities",
        features: {
          run_submission: false,
          run_status: false,
          run_stop: false,
        },
      }),
    );
    return;
  }
  if (req.url === "/v1/skills" || req.url === "/v1/toolsets") {
    res.end("[]");
    return;
  }
  if (req.url === "/v1/chat/completions") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (mode === "partial_close") {
      res.write(
        "data: " +
          JSON.stringify({
            model: "fixture-agent",
            choices: [{ delta: { content: "半段回覆" } }],
          }) +
          "\n\n",
      );
      res.end();
      return;
    }
    res.end(
      "data: " +
        JSON.stringify({
          model: "fixture-agent",
          choices: [{ delta: { content: "完整契約回覆。" } }],
        }) +
        "\n\ndata: [DONE]\n\n",
    );
    return;
  }
  res.writeHead(404).end();
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.HERMES_API_URL =
  "http://127.0.0.1:" + (server.address() as { port: number }).port;

const conversations = await import("../app/api/conversations/route");
const tasks = await import("../app/api/tasks/route");
const health = await import("../app/api/health/route");

type TaskBody = {
  id: string;
  state: string;
  conversationId: string;
  error?: string | null;
  output?: string | null;
};
type ConversationBody = {
  id: string;
  title: string;
  parentId?: string;
  messages: Array<{ id: string; role: string; content: string; taskId?: string }>;
};

function request(path: string, method = "GET", body?: unknown) {
  return new Request("http://localhost:3260/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function refreshHealth() {
  const response = await health.POST(request("health", "POST", {}));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.credential, "valid");
}

async function createConversation(title: string, extra: Record<string, unknown> = {}) {
  const response = await conversations.POST(
    request("conversations", "POST", { title, ...extra }),
  );
  assert.equal(response.status, 201);
  return (await response.json()).conversation as ConversationBody;
}

async function submitTask(conversationId: string, input: string) {
  const response = await tasks.POST(
    request("tasks", "POST", {
      conversationId,
      requestKey: randomUUID(),
      input,
      attachments: [],
    }),
  );
  return { response, body: await response.json() };
}

async function settle(id: string): Promise<TaskBody> {
  for (let count = 0; count < 200; count++) {
    const listed = await (await tasks.GET(request("tasks"))).json();
    const task = (listed.tasks as TaskBody[]).find((item) => item.id === id);
    if (task && ["failed", "uncertain", "completed", "cancelled"].includes(task.state))
      return task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Fixture task did not settle");
}

async function conversationById(id: string) {
  const response = await conversations.GET(request("conversations?id=" + id));
  assert.equal(response.status, 200);
  return (await response.json()).conversation as ConversationBody;
}

test.after(() => {
  server.closeAllConnections();
  server.close();
});

test("acknowledge unblocks the same conversation for a real retry", async () => {
  mode = "partial_close";
  await refreshHealth();
  const conv = await createConversation("待確認後同對話重試");
  const submitted = await submitTask(conv.id, "中途斷線契約");
  assert.equal(submitted.response.status, 202);
  const done = await settle(submitted.body.task.id);
  assert.equal(done.state, "uncertain");
  assert.match(done.error || "", /串流中斷|完成訊號/);

  const blocked = await submitTask(conv.id, "不應在待確認時送出");
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.body.error.code, "conversation_busy");

  const ack = await tasks.PATCH(
    request("tasks", "PATCH", {
      id: done.id,
      action: "acknowledge",
    }),
  );
  assert.equal(ack.status, 200);
  const acked = (await ack.json()).task as TaskBody;
  assert.equal(acked.state, "cancelled");
  assert.match(acked.error || "", /已確認|重新提交|未宣稱遠端/);

  mode = "ok";
  const retry = await submitTask(conv.id, "確認後重試契約");
  assert.equal(retry.response.status, 202);
  const finished = await settle(retry.body.task.id);
  assert.equal(finished.state, "completed");
  assert.equal(finished.output, "完整契約回覆。");
  assert.equal(finished.conversationId, conv.id);
});

test("retry branch keeps the original uncertain record and accepts work on the fork", async () => {
  mode = "partial_close";
  await refreshHealth();
  const parent = await createConversation("待確認後建立重試分支");
  const submitted = await submitTask(parent.id, "分支重試契約");
  assert.equal(submitted.response.status, 202);
  const done = await settle(submitted.body.task.id);
  assert.equal(done.state, "uncertain");

  const stored = await conversationById(parent.id);
  const trigger = stored.messages.find(
    (message) => message.taskId === done.id && message.role === "user",
  );
  assert.ok(trigger, "user message that started the uncertain task must exist");

  const branch = await createConversation(parent.title + " · 分支", {
    parentId: parent.id,
    beforeMessageId: trigger.id,
  });
  assert.equal(branch.parentId, parent.id);
  assert.equal(
    branch.messages.some((message) => message.taskId === done.id),
    false,
    "retry branch must not inherit the uncertain task id",
  );

  const stillBusy = await submitTask(parent.id, "原對話仍待確認");
  assert.equal(stillBusy.response.status, 409);
  assert.equal(stillBusy.body.error.code, "conversation_busy");
  const original = await settle(done.id);
  assert.equal(original.state, "uncertain");
  assert.equal(original.conversationId, parent.id);

  mode = "ok";
  const retry = await submitTask(branch.id, trigger.content);
  assert.equal(retry.response.status, 202);
  const finished = await settle(retry.body.task.id);
  assert.equal(finished.state, "completed");
  assert.equal(finished.conversationId, branch.id);
  assert.equal(finished.output, "完整契約回覆。");
  assert.equal((await settle(done.id)).state, "uncertain");
});
