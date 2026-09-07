import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-clab-"));
process.env.CONSOLE_ORIGIN = "https://console.example";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";
process.env.MCP_BRIDGE_TOKEN = randomBytes(32).toString("hex");
process.env.CONSOLE_VAULT_KEY = randomBytes(32).toString("hex");
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.CONSOLE_MCP_SERVERS_JSON = "[]";
delete process.env.CONSISTENCYLAB_MCP_URL;
delete process.env.CONSISTENCYLAB_MCP_TOKEN;
delete process.env.TKU_MCP_URL;

const calls: string[] = [];
const lab = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (part) => chunks.push(part));
  req.on("end", () => {
    const accept = String(req.headers.accept || "");
    if (
      req.method === "POST" &&
      (!accept.includes("application/json") || !accept.includes("text/event-stream"))
    ) {
      res.writeHead(406, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Accept must include application/json and text/event-stream" }));
      return;
    }
    let body: {
      jsonrpc?: string;
      id?: number;
      method?: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    } = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as typeof body;
    } catch {
      body = {};
    }
    calls.push(body.method || req.method || "");
    res.setHeader("Content-Type", "application/json");
    if (body.method === "initialize") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "ConsistencyLab", version: "0.2.0" },
          },
        }),
      );
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
                name: "get_project_tree",
                description: "Return Project → Scene → Shot graph.",
                inputSchema: { type: "object", properties: { projectId: { type: "string" } } },
                annotations: { readOnlyHint: true },
              },
            ],
          },
        }),
      );
      return;
    }
    if (body.method === "tools/call") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  data: { tree: ["SC01"], tool: body.params?.name, args: body.params?.arguments },
                }),
              },
            ],
            structuredContent: {
              ok: true,
              data: { tree: ["SC01"], tool: body.params?.name },
            },
            isError: false,
          },
        }),
      );
      return;
    }
    if (body.id === undefined) {
      res.writeHead(202);
      res.end();
      return;
    }
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: -32601, message: "Method not found" },
      }),
    );
  });
});
await new Promise<void>((resolve) => lab.listen(0, "127.0.0.1", resolve));
const labUrl =
  "http://127.0.0.1:" + (lab.address() as { port: number }).port + "/api/mcp";
process.env.CONSISTENCYLAB_MCP_URL = labUrl;

const { configuredMcp } = await import("../lib/server/mcp-registry");
const { toolsList, callTool } = await import("../lib/server/mcp");
const { consistencylabConfigured } = await import("../lib/server/consistencylab");
const { routeToolsets } = await import("../lib/server/projects/router");
const { WORKSPACE_OWNER } = await import("../lib/server/security");

test("ConsistencyLab auto-registers and is callable through clab_ workspace tools", async (t) => {
  t.after(() => lab.close());

  await t.test("CONSISTENCYLAB_MCP_URL seeds registry id consistencylab", () => {
    assert.equal(consistencylabConfigured(), true);
    const entry = configuredMcp().find((item) => item.id === "consistencylab");
    assert.ok(entry);
    assert.equal(entry?.endpoint, labUrl);
    assert.equal(entry?.credentialReference, null);
    assert.equal(entry?.readonly, false);
  });

  await t.test("workspace toolsList exposes clab_get_project_tree", () => {
    const names = toolsList(WORKSPACE_OWNER).map((tool) => tool.name);
    assert.ok(names.includes("clab_get_project_tree"));
    assert.ok(names.includes("workspace_project_context"));
  });

  await t.test("clab_ tools/call forwards JSON-RPC to ConsistencyLab", async () => {
    const result = await callTool(
      WORKSPACE_OWNER,
      "clab_get_project_tree",
      { projectId: "demo" },
    );
    assert.equal(result.isError, false);
    assert.equal(result.content[0]?.type, "text");
    const payload = JSON.parse(String(result.content[0]?.text || "{}")) as {
      ok?: boolean;
      data?: { tool?: string };
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.data?.tool, "get_project_tree");
    assert.ok(calls.includes("tools/call"));
  });

  await t.test("連戲 intent selects consistencylab toolset", () => {
    const routed = routeToolsets("檢查小青 Golden 與行李箱連戲");
    assert.ok(routed.toolsets.includes("consistencylab"));
  });
});
