import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-lumen-"));
process.env.CONSOLE_ORIGIN = "https://console.example";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.CONSOLE_MCP_SERVERS_JSON = "[]";
process.env.LUMEN_MCP_TOKEN = randomBytes(24).toString("hex");

const calls: string[] = [];
const clients: string[] = [];
const lumen = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" }).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const part of req) chunks.push(part);
  const message = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
    id?: number;
    method?: string;
    params?: {
      name?: string;
      arguments?: { text?: string };
      clientInfo?: { name?: string };
    };
  };
  if (message.method === "notifications/initialized") {
    res.writeHead(202).end();
    return;
  }
  calls.push(message.method || "");
  if (message.params?.clientInfo?.name) clients.push(message.params.clientInfo.name);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("mcp-session-id", "lumen-contract-session");
  if (message.method === "initialize") {
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "lumen-studio", version: "1.1.0" },
        },
      }),
    );
    return;
  }
  if (message.method === "tools/list") {
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "lumen_utter",
              description: "把口語交給 Lumen 創作導演。",
              inputSchema: { type: "object" },
              annotations: { readOnlyHint: false },
            },
            {
              name: "lumen_health",
              description: "探測 Lumen。",
              inputSchema: { type: "object" },
              annotations: { readOnlyHint: true },
            },
          ],
        },
      }),
    );
    return;
  }
  if (message.method === "tools/call") {
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                speech: "我整理了三個方向。",
                echo: message.params?.arguments?.text || message.params?.name,
              }),
            },
          ],
          structuredContent: { speech: "我整理了三個方向。" },
        },
      }),
    );
    return;
  }
  res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
});
await new Promise<void>((resolve) => lumen.listen(0, "127.0.0.1", resolve));
process.env.LUMEN_MCP_URL =
  "http://127.0.0.1:" + (lumen.address() as { port: number }).port;

const { seedRegistry, probeMcp, getMcp } = await import("../lib/server/mcp-registry");
const { toolsList, callTool } = await import("../lib/server/mcp");
const { resetLumenClient } = await import("../lib/server/lumen");

test("Console seeds Lumen and Hermes can call lumen_utter through workspace MCP", async (t) => {
  await t.test("auto-seed from LUMEN_MCP_URL like 訊核", () => {
    const servers = seedRegistry();
    const lumenEntry = servers.find((item) => item.id === "lumen");
    assert.ok(lumenEntry);
    assert.equal(lumenEntry?.name, "Lumen 創作台");
    assert.equal(lumenEntry?.readonly, false);
    assert.equal(lumenEntry?.credentialReference, "LUMEN_MCP_TOKEN");
  });

  await t.test("workspace MCP advertises lumen_utter only when URL and token are set", () => {
    const previous = process.env.LUMEN_MCP_TOKEN;
    delete process.env.LUMEN_MCP_TOKEN;
    assert.ok(!toolsList("workspace").some((tool) => tool.name === "lumen_utter"));
    process.env.LUMEN_MCP_TOKEN = previous;
    const names = toolsList("workspace").map((tool) => tool.name);
    assert.ok(names.includes("lumen_utter"));
    assert.ok(names.includes("lumen_save_directions"));
    assert.ok(names.includes("workspace_save_directions"));
  });

  await t.test("probe lists lumen tools with official Streamable HTTP", async () => {
    const entry = getMcp("lumen");
    assert.ok(entry);
    const probed = await probeMcp(entry!);
    assert.equal(probed.status, "partial");
    assert.ok(probed.tools.some((tool) => tool.name === "lumen_utter"));
    assert.ok(calls.includes("initialize"));
    assert.ok(calls.includes("tools/list"));
  });

  await t.test("tools/call initializes as hermes-console then returns structured content", async () => {
    resetLumenClient();
    const result = (await callTool("workspace", "lumen_utter", {
      text: "幫我做新生茶會海報",
    })) as { structuredContent?: { result?: { speech?: string } }; content?: Array<{ text: string }> };
    assert.match(JSON.stringify(result), /三個方向/);
    assert.equal(result.structuredContent?.result?.speech, "我整理了三個方向。");
    assert.ok(calls.includes("tools/call"));
    assert.ok(clients.includes("hermes-console"));
  });

  await t.test("reuses MCP session across calls like FrameLab", async () => {
    resetLumenClient();
    const before = calls.filter((method) => method === "initialize").length;
    await callTool("workspace", "lumen_health", {});
    await callTool("workspace", "lumen_list_board", {});
    const after = calls.filter((method) => method === "initialize").length;
    assert.equal(after, before + 1);
  });
});

test.after(() => {
  lumen.closeAllConnections();
  lumen.close();
});
