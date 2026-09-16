import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "atlas-mcp-"));
process.env.CONSOLE_MCP_SERVERS_JSON = "[]";
process.env.ATLAS_MCP_URL = "https://atlas.example/api/mcp";
process.env.ATLAS_MCP_TOKEN = "atlas-console-token-32chars!!";
delete process.env.TKU_MCP_URL;
delete process.env.XUNHE_MCP_URL;
delete process.env.FRAMELAB_MCP_URL;
delete process.env.DUIGAO_MCP_URL;

const { configuredMcp, githubIsNotMcp, atlasStatus } = await import("../lib/server/mcp-registry.ts");

test("ATLAS_MCP_URL auto-registers atlas for Hermes", () => {
  const atlas = configuredMcp().find((item) => item.id === "atlas");
  assert.ok(atlas);
  assert.equal(atlas?.name, "場圖 Atlas");
  assert.equal(atlas?.endpoint, "https://atlas.example/api/mcp");
  assert.equal(atlas?.credentialReference, "ATLAS_MCP_TOKEN");
  assert.equal(atlas?.readonly, false);
});

test("Atlas without token stays unconfigured", () => {
  const token = process.env.ATLAS_MCP_TOKEN;
  delete process.env.ATLAS_MCP_TOKEN;
  try {
    assert.equal(atlasStatus().state, "unconfigured");
    assert.match(atlasStatus().detail, /ATLAS_MCP_TOKEN/);
  } finally {
    process.env.ATLAS_MCP_TOKEN = token;
  }
});

test("GitHub repository URLs are still not MCP endpoints", () => {
  assert.equal(
    githubIsNotMcp("https://github.com/aa0968111723-prog/hermes-console"),
    true,
  );
});
