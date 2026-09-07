import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-lumen-"));
process.env.CONSOLE_ORIGIN = "https://console.example";
process.env.CONSOLE_VAULT_KEY = randomBytes(32).toString("hex");
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";
process.env.LUMEN_MCP_TOKEN = randomBytes(24).toString("hex");

const lumen = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (part) => chunks.push(part));
  req.on("end", () => {
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id: number;
      method: string;
    };
    res.setHeader("Content-Type", "application/json");
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
                description: "utter",
                inputSchema: { type: "object" },
              },
            ],
          },
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ speech: "好。" }) }],
          structuredContent: { speech: "好。" },
        },
      }),
    );
  });
});
await new Promise<void>((resolve) => lumen.listen(0, "127.0.0.1", resolve));
process.env.LUMEN_MCP_URL =
  "http://127.0.0.1:" + (lumen.address() as { port: number }).port;

const { configuredMcp } = await import("../lib/server/mcp-registry");
const { toolsList, callTool } = await import("../lib/server/mcp");

test("Lumen env auto-seeds registry, lists tools, and proxies calls", async () => {
  const seeded = configuredMcp().find((item) => item.id === "lumen");
  assert.equal(seeded?.credentialReference, "LUMEN_MCP_TOKEN");
  assert.ok(toolsList("workspace").some((tool) => tool.name === "lumen_utter"));
  const result = (await callTool("workspace", "lumen_health", {})) as {
    content: Array<{ text: string }>;
  };
  assert.match(result.content[0].text, /speech/);
});

test.after(() => {
  lumen.closeAllConnections();
  lumen.close();
});
