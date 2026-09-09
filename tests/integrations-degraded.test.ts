import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-loop001-degraded-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3260";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";

const { mockStoreThrowForTests } = await import("../lib/server/store");
const integrationsApi = await import("../app/api/integrations/route");
const memoryApi = await import("../app/api/memory/route");

const LEAK = "loop001-pg-password-supersecret";

function request(path: string, method = "GET", body?: unknown) {
  return new Request("http://localhost:3260/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function assertNoSecrets(body: unknown) {
  const text = JSON.stringify(body);
  assert.equal(text.includes(LEAK), false);
  assert.doesNotMatch(text, /postgres(?:ql)?:\/\/\S+/i);
  assert.doesNotMatch(text, /password=/i);
}

test("GET /api/integrations is 200 degraded when store.list throws", async (t) => {
  t.after(() => mockStoreThrowForTests(null));
  mockStoreThrowForTests({
    list() {
      throw new Error(
        "connect ECONNREFUSED postgres://user:" + LEAK + "@127.0.0.1:5432/db",
      );
    },
  });
  const response = await integrationsApi.GET(request("integrations"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.degraded, true);
  assert.equal(body.error?.code, "store_unavailable");
  assert.ok(Array.isArray(body.integrations));
  assert.ok(body.integrations.length > 0);
  assert.ok(body.integrations.some((item: { id: string }) => item.id === "hermes"));
  assert.equal(typeof body.canva?.configured, "boolean");
  assertNoSecrets(body);
});

test("GET /api/integrations stays 200 when canvaStatus store read throws", async (t) => {
  t.after(() => mockStoreThrowForTests(null));
  mockStoreThrowForTests({
    get(kind) {
      if (kind === "canva_status")
        throw new Error("pg canva_status password=" + LEAK);
    },
  });
  const response = await integrationsApi.GET(request("integrations"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.degraded, true);
  assert.ok(body.canva);
  assert.equal(typeof body.canva.configured, "boolean");
  assert.ok(body.integrations.some((item: { id: string }) => item.id === "canva"));
  assertNoSecrets(body);
});

test("GET /api/memory lists store_unavailable instead of internal_error", async (t) => {
  t.after(() => mockStoreThrowForTests(null));
  mockStoreThrowForTests({
    list(kind) {
      if (kind === "shared_memory")
        throw new Error("pg list shared_memory password=" + LEAK);
    },
  });
  const response = await memoryApi.GET(request("memory?scope=all"));
  assert.ok(response.status === 200 || response.status === 503);
  const body = await response.json();
  assert.notEqual(body.error?.code, "internal_error");
  assert.equal(body.error?.code, "store_unavailable");
  assert.ok(Array.isArray(body.memories));
  assert.equal(body.memories.length, 0);
  assertNoSecrets(body);
});

test("POST /api/memory stays 503 when store write throws", async (t) => {
  t.after(() => mockStoreThrowForTests(null));
  mockStoreThrowForTests({
    put() {
      throw new Error("pg write password=" + LEAK);
    },
  });
  const response = await memoryApi.POST(
    request("memory", "POST", {
      kind: "note",
      scope: "workspace",
      title: "不應寫入",
      content: "store fail must not pretend success",
    }),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error?.code, "store_unavailable");
  assert.equal(body.memory, undefined);
  assertNoSecrets(body);
});

test("DELETE /api/memory stays 503 when store write throws", async (t) => {
  const created = await memoryApi.POST(
    request("memory", "POST", {
      kind: "note",
      scope: "workspace",
      title: "待刪",
      content: "刪除時儲存失敗不得假裝成功。",
    }),
  );
  assert.equal(created.status, 201);
  const id = (await created.json()).memory.id as string;
  t.after(() => mockStoreThrowForTests(null));
  mockStoreThrowForTests({
    remove() {
      throw new Error("pg delete password=" + LEAK);
    },
  });
  const response = await memoryApi.DELETE(
    request("memory", "DELETE", { id: id || randomUUID() }),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error?.code, "store_unavailable");
  assert.equal(body.deleted, undefined);
  assertNoSecrets(body);
});
