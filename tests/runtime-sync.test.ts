import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { ToolDescriptor, RuntimeMcpServer } from "../lib/runtime";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-runtime-sync-"));
process.env.HERMES_API_KEY = randomBytes(32).toString("hex");
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.CONSOLE_MCP_SERVERS_JSON = "[]";
let toolNames = ["web_search"];
let toolDescription = "Search the web";
const upstream = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models") return void res.end(JSON.stringify({ data: [{ id: "hermes-fixture" }] }));
  if (req.url === "/v1/capabilities") return void res.end(JSON.stringify({ object: "hermes.api_server.capabilities", features: { run_submission: true, run_status: true, run_events_sse: true, memory: true, responses: false } }));
  if (req.url === "/v1/skills") return void res.end(JSON.stringify([{ name: "brand-writing", description: "Brand writing" }]));
  if (req.url === "/v1/toolsets") return void res.end(JSON.stringify([{ name: "web", description: toolDescription, enabled: true, tools: toolNames }]));
  res.writeHead(404).end();
});
await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
process.env.HERMES_API_URL = "http://127.0.0.1:" + (upstream.address() as { port: number }).port;
const manager = await import("../lib/server/hermes/sync-manager");

test("runtime snapshot discovers, diffs and marks removed tools without hardcoded UI", async () => {
  const first = await manager.syncRuntime("workspace", { force: true });
  assert.equal(first.models[0], "hermes-fixture");
  assert.equal(first.skills[0].name, "brand-writing");
  assert.ok(first.tools.some((t: ToolDescriptor) => t.canonicalName === "hermes.web.web_search"));
  assert.ok(first.tools.some((t: ToolDescriptor) => t.canonicalName.startsWith("console-workspace.")));
  assert.equal(first.memorySupport, "available");
  const hidden = first.tools.find((t: ToolDescriptor) => t.canonicalName === "hermes.web.web_search")!;
  manager.saveRuntimeBinding("workspace", { projectId: "personal", toolName: hidden.canonicalName, enabled: false, priority: 0, allowedTools: [], blockedTools: [], permissionOverrides: {} });
  assert.ok(!manager.runtimeTools("workspace", "personal").some((t: ToolDescriptor) => t.canonicalName === hidden.canonicalName));
  const mcp = createServer(async (req, res) => {
    let body = ""; for await (const part of req) body += part;
    const message = JSON.parse(body || "{}");
    if (message.method === "notifications/initialized") return void res.writeHead(202).end();
    res.setHeader("Content-Type", "application/json");
    if (message.method === "initialize") return void res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "runtime-mcp", version: "1" } } }));
    if (message.method === "tools/list") return void res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "search", description: "MCP search", inputSchema: { type: "object" } }] } }));
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
  });
  await new Promise<void>(resolve => mcp.listen(0, "127.0.0.1", resolve));
  process.env.CONSOLE_MCP_SERVERS_JSON = JSON.stringify([{ id: "tku", name: "TKU", endpoint: "http://127.0.0.1:" + (mcp.address() as { port: number }).port }]);
  const withMcp = await manager.syncRuntime("workspace", { force: true });
  assert.ok(withMcp.tools.some((t: ToolDescriptor) => t.canonicalName === "mcp.tku.search"));
  assert.equal(withMcp.mcpServers.find((server: RuntimeMcpServer) => server.id === "tku")?.status, "partial");
  process.env.CONSOLE_MCP_SERVERS_JSON = "[]";
  await manager.syncRuntime("workspace", { force: true });
  toolNames = ["mcp_tku_search"];
  toolDescription = "Campus search";
  const second = await manager.syncRuntime("workspace", { force: true });
  const diff = manager.runtimeDiff(first, second);
  assert.deepEqual(diff.added, ["hermes.web.mcp_tku_search"]);
  assert.deepEqual(diff.removed, ["hermes.web.web_search"]);
  assert.deepEqual(diff.changed, []);
  assert.ok(!second.tools.some((t: ToolDescriptor) => t.canonicalName === "hermes.web.web_search"));
  const persisted = manager.runtimeSnapshot("workspace");
  assert.equal(persisted?.hash, second.hash);
  mcp.closeAllConnections(); mcp.close();
});

test("stale-while-revalidate preserves last snapshot on upstream failure", async () => {
  const before = manager.runtimeSnapshot("workspace")!;
  upstream.closeAllConnections();
  await new Promise<void>(resolve => upstream.close(() => resolve()));
  const stale = await manager.syncRuntime("workspace", { force: true });
  assert.equal(stale.status, "stale");
  assert.equal(stale.hash, before.hash);
  assert.match(stale.errors[0], /失敗/);
  assert.equal(manager.runtimeSnapshot("workspace")?.status, "stale");
});

process.on("exit", () => { try { upstream.close(); } catch {} });
