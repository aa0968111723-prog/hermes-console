import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

/**
 * LOCAL_CONTRACT only — mock Hermes, not LIVE_EXTERNAL.
 *
 * Mid-stream disconnect and idle timeout must settle as `uncertain`
 * (submitted but not definite), matching tasks.ts: stream_incomplete /
 * idle_timeout are outside the definite-failed code set.
 */
process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-stream-incomplete-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3212";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.HERMES_API_KEY = randomBytes(24).toString("hex");
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.HERMES_CONNECT_TIMEOUT_MS = "1000";
// Short idle so the idle-timeout case finishes quickly under node:test.
process.env.HERMES_IDLE_TIMEOUT_MS = "400";

type Mode = "partial_close" | "idle" | "ok";
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
      // Partial content then abrupt end — no [DONE].
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
    if (mode === "idle") {
      // One frame, then silence until HERMES_IDLE_TIMEOUT_MS fires.
      res.write(
        "data: " +
          JSON.stringify({
            model: "fixture-agent",
            choices: [{ delta: { content: "開始後靜默" } }],
          }) +
          "\n\n",
      );
      // Keep socket open; do not end. Idle race in frames() will reject.
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
const address = server.address() as { port: number };
process.env.HERMES_API_URL = "http://127.0.0.1:" + address.port;

const { put } = await import("../lib/server/store");
const { health } = await import("../lib/server/hermes");
const { submit, taskFor } = await import("../lib/server/tasks");

function conv() {
  const id = randomUUID();
  put("conversation", "owner", {
    id,
    title: "串流中斷契約",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function settle(id: string) {
  for (let count = 0; count < 200; count++) {
    const task = taskFor("owner", id);
    if (["failed", "uncertain", "completed", "cancelled"].includes(task.state))
      return task;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Fixture task did not settle");
}

test.after(() => {
  server.closeAllConnections();
  server.close();
});

test("abrupt stream close without [DONE] settles uncertain", async () => {
  mode = "partial_close";
  await health("owner", true);
  const task = await submit("owner", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "中途斷線契約",
    attachments: [],
  });
  const done = await settle(task.id);
  assert.equal(done.state, "uncertain");
  assert.match(done.error || "", /串流中斷|完成訊號/);
  // Partial text may be retained as preview; must not be treated as completed.
  assert.notEqual(done.state, "completed");
});

test("idle timeout mid-stream settles uncertain", async () => {
  mode = "idle";
  await health("owner", true);
  const task = await submit("owner", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "閒置逾時契約",
    attachments: [],
  });
  const done = await settle(task.id);
  assert.equal(done.state, "uncertain");
  assert.match(done.error || "", /閒置逾時|查回任務/);
});

test("happy path with [DONE] still completes", async () => {
  mode = "ok";
  await health("owner", true);
  const task = await submit("owner", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "正常完成契約",
    attachments: [],
  });
  const done = await settle(task.id);
  assert.equal(done.state, "completed");
  assert.equal(done.output, "完整契約回覆。");
});
