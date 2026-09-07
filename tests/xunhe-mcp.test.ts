import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-xunhe-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3234";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
delete process.env.CONSOLE_VAULT_KEY;

const received: Array<{ method?: string; id?: unknown; name?: string }> = [];
const stub = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c as Buffer));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
      method?: string;
      id?: unknown;
      params?: { name?: string; arguments?: { goal?: string; taskId?: string } };
    };
    received.push({ method: body.method, id: body.id, name: body.params?.name });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("mcp-session-id", "sess-xunhe");
    if (body.method === "initialize") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "xunhe-intel", version: "1.0.0" },
          },
        }),
      );
      return;
    }
    if (body.method?.startsWith("notifications/")) {
      res.writeHead(202).end();
      return;
    }
    if (body.method === "tools/call" && body.params?.name === "xunhe_research") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: "queued" }],
            structuredContent: {
              taskId: "task-live-1",
              status: "queued",
              notice: "任務已建立並開始執行。",
            },
            isError: false,
          },
        }),
      );
      return;
    }
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { message: "unexpected" } }));
  });
});
await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
const port = (stub.address() as { port: number }).port;
process.env.XUNHE_MCP_URL = `http://127.0.0.1:${port}/mcp`;
delete process.env.XUNHE_MCP_TOKEN;

const { githubIsNotMcp } = await import("../lib/server/mcp-registry.ts");
const { invokeXunhe, xunheConfigured } = await import("../lib/server/xunhe.ts");

test("GitHub 倉庫不是訊核 MCP", () => {
  assert.equal(githubIsNotMcp("https://github.com/aa0968111723-prog/hermes-console"), true);
  assert.equal(githubIsNotMcp(`http://127.0.0.1:${port}/mcp`), false);
});

test("設定 XUNHE_MCP_URL 後 Hermes 可呼叫 xunhe_research", async () => {
  assert.equal(xunheConfigured(), true);
  const result = await invokeXunhe("xunhe_research", { goal: "研究 NVIDIA 最近一週 AI 發展" });
  assert.equal(result.taskId, "task-live-1");
  assert.equal(result.xunheTaskId, "task-live-1");
  assert.equal(result.status, "queued");
  assert.ok(received.some((r) => r.method === "initialize"));
  assert.ok(received.some((r) => r.method === "notifications/initialized" && r.id === undefined));
  assert.ok(received.some((r) => r.name === "xunhe_research"));
});

test.after(() => {
  stub.close();
});
