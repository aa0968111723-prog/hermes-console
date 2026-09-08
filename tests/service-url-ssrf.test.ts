import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-ssrf-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3260";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
delete process.env.CONSOLE_MCP_SERVERS_JSON;
delete process.env.LUMEN_MCP_URL;
delete process.env.FRAMELAB_MCP_URL;

const { ApiError, assertSafeServiceUrl, isPrivateOrReservedHost } =
  await import("../lib/server/security");
const { validateHttpsServiceUrl } = await import("../lib/server/settings");
const { configuredMcp } = await import("../lib/server/mcp-registry");
const { invokeLumen, resetLumenClient } = await import("../lib/server/lumen");
const { invokeFramelab } = await import("../lib/server/framelab");
const { target } = await import("../lib/server/hermes");

function rejectsCode(fn: () => unknown, code: string) {
  return assert.rejects(async () => fn(), (error: unknown) => {
    return error instanceof ApiError && error.code === code;
  });
}

test("private IP and cloud metadata hosts are reserved", () => {
  for (const host of [
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "127.0.0.1",
    "0.0.0.0",
    "169.254.169.254",
    "localhost",
    "[::1]",
    "[::ffff:169.254.169.254]",
    "[::ffff:a9fe:a9fe]",
    "metadata.google.internal",
  ])
    assert.equal(isPrivateOrReservedHost(host), true, host);
  assert.equal(isPrivateOrReservedHost("api.zeabur.com"), false);
  assert.equal(isPrivateOrReservedHost("hermes.example"), false);
});

test("validateHttpsServiceUrl blocks private and metadata HTTPS targets", async () => {
  await rejectsCode(
    () => validateHttpsServiceUrl("https://169.254.169.254/latest/meta-data", "mcp"),
    "ssrf_rejected",
  );
  await rejectsCode(
    () => validateHttpsServiceUrl("https://10.0.0.1:8443/internal-admin", "mcp"),
    "ssrf_rejected",
  );
  await rejectsCode(
    () => validateHttpsServiceUrl("https://172.16.0.1/cluster-api", "hermes"),
    "ssrf_rejected",
  );
  await rejectsCode(
    () => validateHttpsServiceUrl("https://192.168.1.1:8080/router", "mcp"),
    "ssrf_rejected",
  );
  await rejectsCode(
    () => validateHttpsServiceUrl("https://[::ffff:169.254.169.254]/graphql", "mcp"),
    "ssrf_rejected",
  );
  const previous = process.env.HERMES_ALLOW_LOOPBACK_HTTP;
  delete process.env.HERMES_ALLOW_LOOPBACK_HTTP;
  try {
    await rejectsCode(
      () => validateHttpsServiceUrl("https://127.0.0.1:8443/internal-rpc", "mcp"),
      "ssrf_rejected",
    );
  } finally {
    process.env.HERMES_ALLOW_LOOPBACK_HTTP = previous;
  }
  assert.equal(
    validateHttpsServiceUrl("https://mcp.example.invalid/api", "mcp"),
    "https://mcp.example.invalid/api",
  );
  assert.equal(
    assertSafeServiceUrl("https://api.zeabur.com/graphql").toString(),
    "https://api.zeabur.com/graphql",
  );
});

test("MCP registry rejects private endpoints", () => {
  process.env.CONSOLE_MCP_SERVERS_JSON = JSON.stringify([
    {
      id: "evil",
      name: "evil",
      endpoint: "https://169.254.169.254/mcp",
      credentialReference: "LUMEN_MCP_TOKEN",
      readonly: true,
    },
  ]);
  assert.throws(
    () => configuredMcp(),
    (error: unknown) => error instanceof ApiError && error.code === "ssrf_rejected",
  );
  delete process.env.CONSOLE_MCP_SERVERS_JSON;
});

test("GALLEY env bootstrap rejects private and metadata hosts", () => {
  const previous = process.env.GALLEY_MCP_URL;
  try {
    process.env.GALLEY_MCP_URL = "https://169.254.169.254/mcp";
    assert.throws(
      () => configuredMcp(),
      (error: unknown) =>
        error instanceof ApiError && error.code === "ssrf_rejected",
    );
    process.env.GALLEY_MCP_URL = "https://10.0.0.5:8080/mcp";
    assert.throws(
      () => configuredMcp(),
      (error: unknown) =>
        error instanceof ApiError && error.code === "ssrf_rejected",
    );
    process.env.GALLEY_MCP_URL = "https://metadata.google.internal/mcp";
    assert.throws(
      () => configuredMcp(),
      (error: unknown) =>
        error instanceof ApiError && error.code === "ssrf_rejected",
    );
  } finally {
    if (previous === undefined) delete process.env.GALLEY_MCP_URL;
    else process.env.GALLEY_MCP_URL = previous;
  }
});

test("lumenRpc and framelabRpc validate protocol and private hosts", async () => {
  process.env.LUMEN_MCP_TOKEN = randomBytes(24).toString("hex");
  process.env.FRAMELAB_MCP_TOKEN = "framelab-token-16";
  process.env.LUMEN_MCP_URL = "http://mcp.example.invalid/api";
  resetLumenClient();
  await rejectsCode(() => invokeLumen("lumen_health", {}), "invalid_url");
  process.env.LUMEN_MCP_URL = "https://10.0.0.8/mcp";
  resetLumenClient();
  await rejectsCode(() => invokeLumen("lumen_health", {}), "ssrf_rejected");
  process.env.FRAMELAB_MCP_URL = "http://mcp.example.invalid/api";
  await rejectsCode(() => invokeFramelab("framelab_list_projects", {}), "invalid_url");
  process.env.FRAMELAB_MCP_URL = "https://169.254.169.254/mcp";
  await rejectsCode(() => invokeFramelab("framelab_list_projects", {}), "ssrf_rejected");
});

test("hermes target rejects private and metadata hosts", async () => {
  await rejectsCode(
    () => target("https://169.254.169.254", "hermes-test-key"),
    "ssrf_rejected",
  );
  await rejectsCode(
    () => target("https://10.0.0.5:8080", "hermes-test-key"),
    "ssrf_rejected",
  );
  await rejectsCode(
    () => target("https://metadata.google.internal", "hermes-test-key"),
    "ssrf_rejected",
  );
  const previous = process.env.HERMES_ALLOW_LOOPBACK_HTTP;
  delete process.env.HERMES_ALLOW_LOOPBACK_HTTP;
  try {
    await rejectsCode(
      () => target("https://127.0.0.2:8443", "hermes-test-key"),
      "ssrf_rejected",
    );
  } finally {
    process.env.HERMES_ALLOW_LOOPBACK_HTTP = previous;
  }
  assert.equal(
    target("https://hermes.example.invalid", "hermes-test-key"),
    "https://hermes.example.invalid",
  );
});
