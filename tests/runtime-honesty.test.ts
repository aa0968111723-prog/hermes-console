import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-runtime-honest-"),
);
process.env.HERMES_API_URL = "";
process.env.HERMES_API_KEY = "";
process.env.CONSOLE_MCP_SERVERS_JSON = "[]";
process.env.MCP_BRIDGE_TOKEN = "";

const { syncRuntime } = await import("../lib/server/hermes/sync-manager");

test("unconfigured Hermes is not reported as stale memory or unknown MCP", async () => {
  const snapshot = await syncRuntime("workspace", { force: true });
  assert.equal(snapshot.status, "unconfigured");
  assert.equal(snapshot.memorySupport, "unconfigured");
  assert.equal(snapshot.sessionsSupport, "unconfigured");
  assert.equal(snapshot.runsSupport, "unconfigured");
  assert.ok(snapshot.mcpServers.length > 0, "built-in MCP catalog still listed");
  assert.ok(
    snapshot.mcpServers.every(
      (server) => server.status === "unconfigured" || !server.enabled,
    ),
    snapshot.mcpServers.map((server) => server.id + ":" + server.status).join(","),
  );
});
