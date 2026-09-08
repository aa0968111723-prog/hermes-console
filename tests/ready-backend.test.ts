import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const dataDir = await mkdtemp(join(tmpdir(), "hermes-ready-"));
process.env.CONSOLE_DATA_DIR = dataDir;
process.env.CONSOLE_ORIGIN = "http://localhost:3255";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
const pgUrl = (process.env.DATABASE_URL || "").trim();
const livePostgres = process.env.CONSOLE_TEST_POSTGRES === "1";
delete process.env.CONSOLE_TEST_POSTGRES;
delete process.env.DATABASE_URL;
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;

const { probeStore, resetStoreForTests, storeBackend } =
  await import("../lib/server/store");
const readyRoute = await import("../app/api/ready/route");
const healthRoute = await import("../app/api/health/route");

function request(path: string) {
  return new Request("http://localhost:3255/api/" + path, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
  });
}

function assertNoSecrets(body: unknown, extra: string[] = []) {
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /postgres(?:ql)?:\/\/\S+/i);
  assert.doesNotMatch(text, /DATABASE_URL\s*=/);
  assert.doesNotMatch(text, /cutos_memory_items/i);
  assert.doesNotMatch(text, /\bai_os\b/i);
  for (const value of extra) {
    if (value) assert.equal(text.includes(value), false);
  }
}

test("blank DATABASE_URL and .env.example stay sqlite without credentials", async () => {
  const example = await readFile(
    new URL("../.env.example", import.meta.url),
    "utf8",
  );
  const urlLine = example
    .split(/\r?\n/)
    .find((line) => line.startsWith("DATABASE_URL="));
  assert.equal(urlLine, "DATABASE_URL=");
  assert.doesNotMatch(example, /postgres(?:ql)?:\/\/\S+:\S+@/i);

  for (const value of ["", "   "]) {
    process.env.DATABASE_URL = value;
    resetStoreForTests();
    assert.equal(storeBackend(), "sqlite");
    const probe = probeStore();
    assert.equal(probe.ok, true);
    assert.equal(probe.backend, "sqlite");
    assert.equal(probe.dataDir, dataDir);
  }
  delete process.env.DATABASE_URL;
  resetStoreForTests();
  assert.equal(storeBackend(), "sqlite");
});

test("GET /api/ready probes sqlite dataDir and returns 200", async () => {
  resetStoreForTests();
  const response = await readyRoute.GET(request("ready"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ready, true);
  assert.equal(body.backend, "sqlite");
  assert.equal(body.dataDir, dataDir);
  assert.equal(body.error, undefined);
  assertNoSecrets(body);
});

test("GET /api/ready returns 503 when the store probe fails", async () => {
  const blocked = join(tmpdir(), "hermes-ready-blocked-" + randomUUID());
  await writeFile(blocked, "not-a-directory");
  const previous = process.env.CONSOLE_DATA_DIR;
  process.env.CONSOLE_DATA_DIR = blocked;
  resetStoreForTests();
  try {
    const probe = probeStore();
    assert.equal(probe.ok, false);
    assert.equal(probe.backend, "sqlite");
    const response = await readyRoute.GET(request("ready"));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ready, false);
    assert.equal(body.backend, "sqlite");
    assert.equal(body.dataDir, resolve(blocked));
    assert.equal(body.error?.code, "store_unavailable");
    assert.equal(body.error?.message, "儲存庫無法使用。");
    assertNoSecrets(body);
  } finally {
    process.env.CONSOLE_DATA_DIR = previous;
    resetStoreForTests();
  }
});

test("health and ready backend fields omit secrets", async () => {
  const secret = "ready-secret-token-" + randomUUID();
  process.env.DATABASE_URL = "postgres://user:" + secret + "@127.0.0.1:1/db";
  resetStoreForTests();
  try {
    assert.equal(storeBackend(), "sqlite");
    const ready = await readyRoute.GET(request("ready"));
    assert.equal(ready.status, 200);
    const readyBody = await ready.json();
    assert.equal(readyBody.backend, "sqlite");
    assert.equal(readyBody.dataDir, dataDir);
    assert.equal(readyBody.ready, true);
    assertNoSecrets(readyBody, [secret]);

    const health = await healthRoute.GET(request("health"));
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.backend, "sqlite");
    assert.equal(healthBody.dataDir, dataDir);
    assert.equal(healthBody.storeReady, true);
    assert.ok(healthBody.configSource);
    assertNoSecrets(healthBody, [secret]);
  } finally {
    delete process.env.DATABASE_URL;
    resetStoreForTests();
  }
});

test("GET /api/ready does not require a member session or gateway", async () => {
  const anonymous = new Request("http://localhost:3255/api/ready");
  const response = await readyRoute.GET(anonymous);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ready, true);
  assert.equal(body.backend, "sqlite");
});

test(
  "GET /api/ready postgres probe when DATABASE_URL and CONSOLE_TEST_POSTGRES=1",
  {
    skip:
      !livePostgres || !/^postgres(ql)?:\/\//i.test(pgUrl),
  },
  async () => {
    process.env.CONSOLE_TEST_POSTGRES = "1";
    process.env.DATABASE_URL = pgUrl;
    resetStoreForTests();
    try {
      const response = await readyRoute.GET(request("ready"));
      const body = await response.json();
      assert.equal(body.backend, "postgres");
      assert.ok(response.status === 200 || response.status === 503);
      assert.equal(body.ready, response.status === 200);
      assert.equal(body.dataDir, dataDir);
      assertNoSecrets(body);
      const health = await healthRoute.GET(request("health"));
      const healthBody = await health.json();
      assert.equal(healthBody.backend, "postgres");
      assert.equal(healthBody.storeReady, body.ready);
      assertNoSecrets(healthBody);
    } finally {
      delete process.env.CONSOLE_TEST_POSTGRES;
      delete process.env.DATABASE_URL;
      resetStoreForTests();
    }
  },
);
