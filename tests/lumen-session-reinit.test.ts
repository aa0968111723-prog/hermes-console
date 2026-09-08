import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// LOCAL_CONTRACT only. Not a live Lumen / MCP integration.
process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-lumen-session-"),
);
process.env.CONSOLE_ORIGIN = "https://console.example";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.LUMEN_MCP_TOKEN = randomBytes(24).toString("hex");

type RpcMessage = {
  id?: number;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};

const seen: Array<{ method: string; session: string | null; tool?: string }> =
  [];
let initializeCount = 0;
let failNextCall = false;

const server = createServer(async (req: IncomingMessage, res) => {
  const chunks: Buffer[] = [];
  for await (const part of req) chunks.push(part);
  const message = JSON.parse(
    Buffer.concat(chunks).toString("utf8") || "{}",
  ) as RpcMessage;
  const session = req.headers["mcp-session-id"]
    ? String(req.headers["mcp-session-id"])
    : null;
  seen.push({
    method: message.method || "",
    session,
    tool: message.params?.name,
  });

  if (message.method === "notifications/initialized") {
    res.writeHead(202).end();
    return;
  }

  res.setHeader("Content-Type", "application/json");

  if (message.method === "initialize") {
    initializeCount += 1;
    const next = initializeCount === 1 ? "sess-old" : "sess-new";
    res.setHeader("mcp-session-id", next);
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "lumen-session-fixture", version: "1" },
        },
      }),
    );
    return;
  }

  if (message.method === "tools/call" && session === "sess-old") {
    res.writeHead(404).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Session not found" },
      }),
    );
    return;
  }

  if (message.method === "tools/call" && failNextCall) {
    failNextCall = false;
    res.setHeader("mcp-session-id", session || "sess-new");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          isError: true,
          content: [{ type: "text", text: "工具本身失敗，不應重送。" }],
        },
      }),
    );
    return;
  }

  if (message.method === "tools/call") {
    res.setHeader("mcp-session-id", session || "sess-new");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          structuredContent: {
            speech: "工作階段已重建，這不是實機驗證。",
            recovered: true,
          },
        },
      }),
    );
    return;
  }

  res.writeHead(404).end();
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.LUMEN_MCP_URL =
  "http://127.0.0.1:" + (server.address() as { port: number }).port;

const { resetLumenClient, invokeLumen } = await import("../lib/server/lumen");

test("HTTP 404 after Mcp-Session-Id re-initializes without the stale header", async () => {
  resetLumenClient();
  seen.length = 0;
  initializeCount = 0;
  failNextCall = false;

  const result = await invokeLumen("lumen_utter", { text: "請整理三個方向" });
  assert.equal(result.recovered, true);
  assert.match(String(result.speech), /工作階段已重建/);

  const initializes = seen.filter((row) => row.method === "initialize");
  assert.equal(initializes.length, 2);
  assert.equal(initializes[0].session, null);
  assert.equal(initializes[1].session, null);

  const calls = seen.filter((row) => row.method === "tools/call");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].session, "sess-old");
  assert.equal(calls[0].tool, "lumen_utter");
  assert.equal(calls[1].session, "sess-new");
  assert.equal(calls[1].tool, "lumen_utter");
});

test("tool application errors are not retried as a new session", async () => {
  resetLumenClient();
  seen.length = 0;
  initializeCount = 0;
  failNextCall = false;

  await invokeLumen("lumen_utter", { text: "先建立有效工作階段" });
  const initsAfterWarmup = seen.filter((row) => row.method === "initialize").length;
  const callsAfterWarmup = seen.filter((row) => row.method === "tools/call").length;

  failNextCall = true;
  await assert.rejects(
    () => invokeLumen("lumen_utter", { text: "這次工具會失敗" }),
    /工具本身失敗/,
  );

  assert.equal(
    seen.filter((row) => row.method === "initialize").length,
    initsAfterWarmup,
  );
  assert.equal(
    seen.filter((row) => row.method === "tools/call").length,
    callsAfterWarmup + 1,
  );
});

test.after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
