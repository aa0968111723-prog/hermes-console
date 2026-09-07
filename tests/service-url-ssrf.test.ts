import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-ssrf-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3260";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
delete process.env.CONSOLE_MCP_SERVERS_JSON;
delete process.env.GALLEY_MCP_URL;

const { ApiError, assertSafeServiceUrl, isPrivateOrReservedHost } =
  await import("../lib/server/security");
const { configuredMcp } = await import("../lib/server/mcp-registry");

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

test("assertSafeServiceUrl blocks private and metadata HTTPS targets", () => {
  assert.throws(
    () => assertSafeServiceUrl("https://169.254.169.254/latest/meta-data", "mcp"),
    (error: unknown) =>
      error instanceof ApiError && error.code === "ssrf_rejected",
  );
  assert.throws(
    () => assertSafeServiceUrl("https://10.0.0.1:8443/internal-admin", "mcp"),
    (error: unknown) =>
      error instanceof ApiError && error.code === "ssrf_rejected",
  );
  assert.throws(
    () => assertSafeServiceUrl("http://mcp.example.invalid/mcp", "mcp"),
    (error: unknown) =>
      error instanceof ApiError && error.code === "invalid_url",
  );
  assert.equal(
    assertSafeServiceUrl("https://api.zeabur.com/graphql").toString(),
    "https://api.zeabur.com/graphql",
  );
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
