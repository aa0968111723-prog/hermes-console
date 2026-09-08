import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-duigao-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3236";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.CONSOLE_MCP_SERVERS_JSON = "[]";
delete process.env.CONSOLE_VAULT_KEY;
delete process.env.TKU_MCP_URL;
delete process.env.XUNHE_MCP_URL;
delete process.env.ATLAS_MCP_URL;
delete process.env.FRAMELAB_MCP_URL;

const received: Array<{ method?: string; id?: unknown; name?: string; auth?: string }> = [];
const stub = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c as Buffer));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
      method?: string;
      id?: unknown;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    received.push({
      method: body.method,
      id: body.id,
      name: body.params?.name,
      auth: typeof req.headers.authorization === "string" ? req.headers.authorization : undefined,
    });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("mcp-session-id", "sess-duigao");
    if (body.method === "initialize") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "duigao-studio", version: "1.0.0" },
          },
        }),
      );
      return;
    }
    if (body.method?.startsWith("notifications/")) {
      res.writeHead(202).end();
      return;
    }
    if (body.method === "tools/list") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "create_draft",
                description: "Create a poster draft",
                inputSchema: { type: "object" },
                annotations: { readOnlyHint: false, destructiveHint: false },
              },
            ],
          },
        }),
      );
      return;
    }
    if (body.method === "tools/call" && body.params?.name === "create_draft") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [
              {
                type: "text",
                text: '{"id":"d-1","name":"秋季社員大會","studioPath":"/studio/d-1"}',
              },
            ],
            structuredContent: {
              id: "d-1",
              name: body.params.arguments?.name || "未命名",
              headline: body.params.arguments?.headline,
              studioPath: "/studio/d-1",
            },
            isError: false,
          },
        }),
      );
      return;
    }
    if (body.method === "tools/call" && body.params?.name === "status") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            structuredContent: { server: "duigao-studio", path: "/api/mcp" },
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
process.env.DUIGAO_MCP_URL = `http://127.0.0.1:${port}/api/mcp`;
process.env.DUIGAO_MCP_TOKEN = "dg_hermes_contract_token_aaaaaa";

const { githubIsNotMcp, configuredMcp } = await import("../lib/server/mcp-registry.ts");
const { invokeDuigao, duigaoConfigured, isDuigaoTool } = await import("../lib/server/duigao.ts");
const { toolsList } = await import("../lib/server/mcp.ts");

test("GitHub 倉庫不是對稿 MCP", () => {
  assert.equal(githubIsNotMcp("https://github.com/aa0968111723-prog/river-spruce-bay-fair"), true);
  assert.equal(githubIsNotMcp(`http://127.0.0.1:${port}/api/mcp`), false);
});

test("DUIGAO_MCP_URL 自動進入核准清單且 id 為 duigao", () => {
  const configs = configuredMcp();
  const entry = configs.find((c) => c.id === "duigao");
  assert.ok(entry);
  assert.equal(entry?.name, "對稿工作室");
  assert.equal(entry?.readonly, false);
  assert.equal(entry?.credentialReference, "DUIGAO_MCP_TOKEN");
  assert.match(entry?.endpoint || "", /\/api\/mcp$/);
});

test("設定後 Hermes 可經工作區 MCP 呼叫對稿", async () => {
  assert.equal(duigaoConfigured(), true);
  assert.equal(isDuigaoTool("duigao_create_draft"), true);
  assert.equal(isDuigaoTool("duigao_call"), true);
  const listed = toolsList("workspace");
  assert.ok(listed.some((t) => t.name === "duigao_create_draft"));
  assert.ok(listed.some((t) => t.name === "duigao_apply_copy"));
  const create = listed.find((t) => t.name === "duigao_create_draft");
  assert.equal(create?.annotations?.readOnlyHint, false);

  const result = await invokeDuigao("duigao_create_draft", {
    name: "秋季社員大會",
    headline: "秋季社員大會",
  });
  assert.equal(result.id, "d-1");
  assert.equal(result.studioPath, "/studio/d-1");
  assert.ok(received.some((r) => r.method === "initialize"));
  assert.ok(received.some((r) => r.method === "notifications/initialized" && r.id === undefined));
  assert.ok(received.some((r) => r.name === "create_draft"));
  assert.ok(received.every((r) => !r.auth || r.auth === "Bearer dg_hermes_contract_token_aaaaaa"));

  const status = await invokeDuigao("duigao_status", {});
  assert.equal(status.server, "duigao-studio");
});

test.after(() => {
  stub.close();
});
