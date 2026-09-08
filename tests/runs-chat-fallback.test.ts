import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// LOCAL_CONTRACT only. Not a live Hermes integration.
process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-runs-fallback-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3221";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.HERMES_API_KEY = randomBytes(24).toString("hex");
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.HERMES_CONNECT_TIMEOUT_MS = "1000";
process.env.HERMES_IDLE_TIMEOUT_MS = "800";

let runMode: "missing" | "malformed" = "missing";
let sessionMode: "off" | "fail" = "off";
let runsHits = 0;
let chatHits = 0;
let sessionHits = 0;

const server = createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer " + process.env.HERMES_API_KEY) {
    res.writeHead(401).end();
    return;
  }
  for await (const _part of req) {
    /* drain */
  }
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models") {
    res.end(JSON.stringify({ data: [{ id: "fixture-agent" }] }));
    return;
  }
  if (req.url === "/v1/capabilities") {
    res.end(
      JSON.stringify({
        object: "hermes.api_server.capabilities",
        features: {
          run_submission: true,
          run_status: true,
          run_stop: true,
          session_resources: sessionMode === "fail",
        },
      }),
    );
    return;
  }
  if (req.url === "/v1/skills" || req.url === "/v1/toolsets") {
    res.end("[]");
    return;
  }
  if (req.url === "/api/sessions") {
    sessionHits += 1;
    res.writeHead(500).end(JSON.stringify({ error: "session fixture down" }));
    return;
  }
  if (req.url === "/v1/runs") {
    runsHits += 1;
    if (runMode === "missing") {
      res.writeHead(501).end(JSON.stringify({ error: "runs not implemented" }));
      return;
    }
    res.writeHead(200).end(JSON.stringify({ status: "started" }));
    return;
  }
  if (req.url === "/v1/chat/completions") {
    chatHits += 1;
    res.setHeader("Content-Type", "text/event-stream");
    res.write(
      "data: " +
        JSON.stringify({
          model: "fixture-agent",
          choices: [{ delta: { content: "契約測試降級回覆，不是實機驗證。" } }],
        }) +
        "\n\n",
    );
    res.end("data: [DONE]\n\n");
    return;
  }
  res.writeHead(404).end();
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number };
process.env.HERMES_API_URL = "http://127.0.0.1:" + address.port;

const { put } = await import("../lib/server/store");
const { health } = await import("../lib/server/hermes");
const { submit, taskFor } = await import("../lib/server/tasks");

function conversation() {
  const id = randomUUID();
  put("conversation", "owner", {
    id,
    title: "降級契約",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function settle(id: string) {
  for (let count = 0; count < 100; count++) {
    const task = taskFor("owner", id);
    if (["failed", "uncertain", "completed", "cancelled"].includes(task.state))
      return task;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Fallback fixture task did not settle");
}

test.after(() => {
  server.closeAllConnections();
  server.close();
});

test("runs 501 falls back to chat stream instead of failing the task", async () => {
  runMode = "missing";
  sessionMode = "off";
  runsHits = 0;
  chatHits = 0;
  await health("owner", true);
  const task = await submit("owner", {
    conversationId: conversation(),
    requestKey: randomUUID(),
    input: "測試 runs 未實作時要能續談",
    attachments: [],
  });
  assert.equal(task.transport, "runs");
  const settled = await settle(task.id);
  assert.equal(runsHits, 1);
  assert.equal(chatHits, 1);
  assert.equal(settled.transport, "chat");
  assert.equal(settled.state, "completed");
  assert.equal(settled.remoteId, null);
  assert.match(settled.output, /契約測試降級回覆/);
  assert.ok(
    settled.events.some((item) =>
      item.summary.includes("runs 通道暫時不可用"),
    ),
  );
});

test("malformed runs payload without id also continues on chat", async () => {
  runMode = "malformed";
  sessionMode = "off";
  runsHits = 0;
  chatHits = 0;
  await health("owner", true);
  const task = await submit("owner", {
    conversationId: conversation(),
    requestKey: randomUUID(),
    input: "測試 runs 回應形狀不符",
    attachments: [],
  });
  const settled = await settle(task.id);
  assert.equal(runsHits, 1);
  assert.equal(chatHits, 1);
  assert.equal(settled.transport, "chat");
  assert.equal(settled.state, "completed");
  assert.equal(settled.remoteId, null);
  assert.ok(
    settled.events.some((item) =>
      item.summary.includes("runs 通道暫時不可用"),
    ),
  );
});

test("session precreate 500 does not fail the task", async () => {
  runMode = "missing";
  sessionMode = "fail";
  runsHits = 0;
  chatHits = 0;
  sessionHits = 0;
  await health("owner", true);
  const task = await submit("owner", {
    conversationId: conversation(),
    requestKey: randomUUID(),
    input: "測試會話預建失敗仍續行",
    attachments: [],
  });
  const settled = await settle(task.id);
  assert.equal(sessionHits, 1);
  assert.equal(runsHits, 1);
  assert.equal(chatHits, 1);
  assert.equal(settled.state, "completed");
  assert.ok(
    settled.events.some((item) =>
      item.summary.includes("Hermes 會話預建未成功"),
    ),
  );
  assert.ok(
    settled.events.some((item) =>
      item.summary.includes("runs 通道暫時不可用"),
    ),
  );
});
