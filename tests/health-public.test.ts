import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-health-public-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3377";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_AUTH_MODE = "required";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;

const { put } = await import("../lib/server/store");
const { publicHealthStatus, redactHealthDiscovery } = await import(
  "../lib/server/health-public"
);
const healthRoute = await import("../app/api/health/route");

function request(cookie?: string) {
  return new Request("http://localhost:3377/api/health", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3377",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}

test("public health redacts models, skills, toolsets, and features", () => {
  const redacted = redactHealthDiscovery({
    checkedAt: "2026-09-16T00:00:00.000Z",
    reachable: true,
    credential: "valid",
    agent: "verified",
    status: "partial",
    message: "ok",
    httpStatus: 200,
    features: { chat: true },
    models: ["hidden-model"],
    skills: [{ name: "hidden-skill", description: "internal" }],
    toolsets: [{ name: "hidden-tools", description: "internal" }],
    discovery: { skills: "available" },
    configSource: { hermesUrl: "env", hermesKey: "env" },
    backend: "sqlite",
    dataDir: "/tmp",
    storeReady: true,
  });
  assert.deepEqual(redacted.models, []);
  assert.deepEqual(redacted.skills, []);
  assert.deepEqual(redacted.toolsets, []);
  assert.deepEqual(redacted.features, {});
  assert.deepEqual(redacted.discovery, {});
  assert.equal(redacted.credential, "valid");
  assert.equal(redacted.configSource?.hermesKey, "env");
});

test("anonymous GET /api/health in required mode omits discovery catalogs", async () => {
  put("health", "workspace", {
    id: "current",
    targetHash: "fixture",
    checkedAt: "2026-09-16T00:00:00.000Z",
    reachable: true,
    credential: "valid",
    agent: "verified",
    status: "partial",
    message: "cached",
    httpStatus: 200,
    features: { chat: true },
    models: ["should-not-leak"],
    skills: [{ name: "should-not-leak", description: "internal" }],
    toolsets: [{ name: "should-not-leak", description: "internal" }],
    discovery: { skills: "available" },
    configSource: { hermesUrl: "env", hermesKey: "env" },
    backend: "sqlite",
    dataDir: process.env.CONSOLE_DATA_DIR!,
    storeReady: true,
  });
  const cached = publicHealthStatus("workspace");
  assert.deepEqual(cached.models, []);
  assert.equal(
    JSON.stringify(cached).includes("should-not-leak"),
    false,
  );

  const response = await healthRoute.GET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.models, []);
  assert.deepEqual(body.skills, []);
  assert.deepEqual(body.toolsets, []);
  assert.deepEqual(body.features, {});
  assert.ok(body.configSource);
  assert.equal(body.storeReady, true);
  assert.equal(JSON.stringify(body).includes("should-not-leak"), false);
  assert.doesNotMatch(JSON.stringify(body), /Bearer |api[_-]?key/i);
});
