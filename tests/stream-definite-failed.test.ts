import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

/**
 * LOCAL_CONTRACT only — mock Hermes, not LIVE_EXTERNAL.
 * Covers stream failures Console can classify as definite failed so the UI
 * can offer「建立重試分支」without leaving the task as uncertain.
 */
process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-stream-definite-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3210";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.HERMES_API_KEY = randomBytes(24).toString("hex");
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.HERMES_CONNECT_TIMEOUT_MS = "1000";
process.env.HERMES_IDLE_TIMEOUT_MS = "2000";

type Mode = "ok" | "frame_too_large" | "invalid_json";
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
    if (mode === "frame_too_large") {
      // Exceeds the 2_000_000 character SSE buffer / event limit.
      res.write("data: " + "x".repeat(2_000_001) + "\n\n");
      res.end();
      return;
    }
    if (mode === "invalid_json") {
      res.write("data: {not-json\n\n");
      res.end();
      return;
    }
    res.end(
      "data: " +
        JSON.stringify({
          model: "fixture-agent",
          choices: [{ delta: { content: "契約測試回覆。" } }],
        }) +
        "\n\ndata: [DONE]\n\n",
    );
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

function conv() {
  const id = randomUUID();
  put("conversation", "owner", {
    id,
    title: "串流契約",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function settle(id: string) {
  for (let count = 0; count < 150; count++) {
    const task = taskFor("owner", id);
    if (["failed", "uncertain", "completed", "cancelled"].includes(task.state))
      return task;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Fixture task did not settle");
}

test("stream frame_too_large is definite failed with clear message", async () => {
  mode = "frame_too_large";
  await health("owner", true);
  const task = await submit("owner", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "超大串流契約",
    attachments: [],
  });
  const done = await settle(task.id);
  assert.equal(done.state, "failed");
  assert.match(done.error || "", /大小限制|工具事件/);
  assert.equal(done.output, "");
});

test("invalid stream JSON is definite failed", async () => {
  mode = "invalid_json";
  await health("owner", true);
  const task = await submit("owner", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "格式錯誤契約",
    attachments: [],
  });
  const done = await settle(task.id);
  assert.equal(done.state, "failed");
  assert.match(done.error || "", /串流格式錯誤/);
});

test("happy path still completes", async () => {
  mode = "ok";
  await health("owner", true);
  const task = await submit("owner", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "正常契約",
    attachments: [],
  });
  const done = await settle(task.id);
  assert.equal(done.state, "completed");
  assert.equal(done.output, "契約測試回覆。");
});

test.after(() => {
  server.closeAllConnections();
  server.close();
});
