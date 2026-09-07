import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-galley-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3233";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";
process.env.MCP_BRIDGE_TOKEN = randomBytes(32).toString("hex");
process.env.CONSOLE_VAULT_KEY = randomBytes(32).toString("hex");
delete process.env.GALLEY_MCP_URL;
delete process.env.GALLEY_MCP_TOKEN;
delete process.env.CONSOLE_MCP_SERVERS_JSON;
delete process.env.TKU_MCP_URL;

const galleyCalls: string[] = [];
const galleyToken = randomBytes(24).toString("hex");
const galley = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (part) => chunks.push(part));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    res.setHeader("Content-Type", "application/json");
    let parsed: Record<string, unknown> = {};
    try {
      parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }
    const message = parsed as { id?: unknown; method?: string; params?: { name?: string } };
    if (message.method) galleyCalls.push(message.method);
    const auth = String(req.headers.authorization || "");
    if (auth !== "Bearer " + galleyToken) {
      res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (message.method === "initialize") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "galley-research", version: "1" },
          },
        }),
      );
      return;
    }
    if (message.method === "notifications/initialized") {
      res.end("{}");
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
                name: "galley_capability",
                description: "capability",
                inputSchema: { type: "object" },
              },
              {
                name: "galley_research",
                description: "research",
                inputSchema: { type: "object" },
              },
            ],
          },
        }),
      );
      return;
    }
    if (message.method === "tools/call") {
      const payload = {
        name: "GALLEY",
        protocol: "2025-06-18",
        tool: message.params?.name || "galley_capability",
        xaiConfigured: false,
      };
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(payload) }],
            structuredContent: { result: payload },
            isError: false,
          },
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { message: "unknown method" },
      }),
    );
  });
});
await new Promise<void>((resolve) => galley.listen(0, "127.0.0.1", resolve));
const galleyUrl =
  "http://127.0.0.1:" + (galley.address() as { port: number }).port;

const { configuredMcp, githubIsNotMcp } = await import(
  "../lib/server/mcp-registry"
);
const { toolsList, callTool } = await import("../lib/server/mcp");
const { galleyConfigured, galleyStatus } = await import("../lib/server/galley");
const { WORKSPACE_OWNER } = await import("../lib/server/security");

test("GALLEY MCP auto-seed and workspace proxy", async (t) => {
  t.after(() => galley.close());

  await t.test("GitHub is still not an MCP endpoint", () => {
    assert.equal(githubIsNotMcp("https://github.com/aa0968111723-prog/hermes-console"), true);
  });

  await t.test("unconfigured status is honest", () => {
    assert.equal(galleyConfigured(), false);
    assert.equal(galleyStatus().state, "unconfigured");
  });

  await t.test("workspace tools advertise galley proxies even before URL is set", () => {
    const names = toolsList(WORKSPACE_OWNER).map((tool) => tool.name);
    assert.ok(names.includes("galley_capability"));
    assert.ok(names.includes("galley_research"));
    assert.ok(names.includes("galley_intel"));
  });

  await t.test("missing GALLEY credentials fail closed", async () => {
    const result = await callTool(WORKSPACE_OWNER, "galley_capability", {});
    assert.equal(result.isError, true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert.match(text, /GALLEY_MCP/);
  });

  await t.test("URL auto-seeds registry and capability proxies", async () => {
    process.env.GALLEY_MCP_URL = galleyUrl;
    process.env.GALLEY_MCP_TOKEN = galleyToken;
    const configs = configuredMcp();
    const entry = configs.find((item) => item.id === "galley");
    assert.ok(entry);
    assert.equal(entry?.credentialReference, "GALLEY_MCP_TOKEN");
    assert.equal(entry?.readonly, false);
    assert.equal(galleyConfigured(), true);

    const result = await callTool(WORKSPACE_OWNER, "galley_capability", {});
    assert.equal(result.isError, false);
    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text,
    ) as { name?: string; protocol?: string };
    assert.equal(parsed.name, "GALLEY");
    assert.equal(parsed.protocol, "2025-06-18");
    assert.ok(galleyCalls.includes("tools/call"));
  });
});
