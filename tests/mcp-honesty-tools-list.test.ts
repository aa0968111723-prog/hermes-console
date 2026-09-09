import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Health } from "../lib/contracts";

/**
 * LOCAL_CONTRACT named after LIVE bug REAL-TEST-2026-09-10-L2-B1:
 * GET /api/mcp-registry listed Tamkang tools (getToDo, getBulletins, getCourses)
 * after initialize + tools/list, but GET /api/integrations and chat
 * researchBundle still said awaiting_authorization / 尚未完成 initialize／tools/list.
 */
process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-mcp-honesty-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3294";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
process.env.TKU_MCP_URL = "https://example.com/mcp";
process.env.TKU_MCP_TOKEN = "x".repeat(40);
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;

const { put } = await import("../lib/server/store");
const { WORKSPACE_OWNER } = await import("../lib/server/security");

put("mcp_registry", WORKSPACE_OWNER, {
  id: "tku",
  name: "Tamkang MCP",
  endpoint: "https://example.com/mcp",
  credentialReference: "TKU_MCP_TOKEN",
  transport: "streamable-http",
  authMode: "bearer",
  tools: [
    { name: "getToDo", description: "todos" },
    { name: "getBulletins", description: "bulletins" },
    { name: "getCourses", description: "courses" },
  ],
  status: "partial",
  verifiedAt: "2026-09-09T23:04:19.773Z",
  lastError: null,
  readonly: true,
  trustedLevel: "external",
  enabled: true,
});

const { liveTamkangStatus, tamkangStatus } = await import(
  "../lib/server/tamkang"
);
const { researchBundle } = await import("../lib/server/research/providers");
const { integrationsSnapshot } = await import("../lib/server/integrations");

const health: Health = {
  checkedAt: "2026-09-10T00:00:00.000Z",
  reachable: true,
  credential: "valid",
  agent: "verified",
  status: "available",
  message: "ok",
  httpStatus: 200,
  features: {},
  models: [],
  skills: [],
  toolsets: [],
  backend: "sqlite",
  dataDir: process.env.CONSOLE_DATA_DIR!,
  storeReady: true,
};

test("past bug: tools/list done must not stay awaiting_authorization", () => {
  const unprobed = tamkangStatus();
  assert.equal(unprobed.state, "awaiting_authorization");

  const live = liveTamkangStatus();
  assert.equal(live.state, "partial");
  assert.match(live.detail, /已列出工具/);
  assert.doesNotMatch(live.detail, /尚未完成 initialize/);
  assert.equal(live.mapping.tku_courses, "getCourses");
  assert.notEqual(live.state, "available");
});

test("past bug: researchBundle and integrations read registry tools/list", () => {
  const bundle = researchBundle({ prompt: "幫我找 115-1 的期初活動" });
  const tamkang = bundle.tamkang as {
    state: string;
    detail: string;
  };
  const mapping = bundle.mapping as { tku_courses: string | null };
  assert.equal(tamkang.state, "partial");
  assert.match(tamkang.detail, /已列出工具/);
  assert.doesNotMatch(tamkang.detail, /尚未完成 initialize／tools\/list/);
  assert.equal(mapping.tku_courses, "getCourses");
  assert.equal(bundle.executed, false);

  const snapshot = integrationsSnapshot("workspace", health);
  const tku = snapshot.integrations.find((item) => item.id === "tku");
  assert.ok(tku);
  assert.equal(tku.state, "partial");
  assert.match(tku.detail, /已列出工具/);
  assert.doesNotMatch(tku.detail, /尚未完成 initialize／tools\/list/);
  assert.ok(tku.tools.includes("getToDo"));
  assert.ok(tku.tools.includes("getBulletins"));
  assert.ok(tku.tools.includes("getCourses"));
});
