import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-agents-brain-tasks-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3261";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;

const { mockStoreThrowForTests, put } = await import("../lib/server/store");
const tasksApi = await import("../app/api/tasks/route");
const agentsApi = await import("../app/api/agents/route");
const brainApi = await import("../app/api/brain/route");

const LEAK = "agents-brain-pg-password-supersecret";

function request(path: string, method = "GET", body?: unknown) {
  return new Request("http://localhost:3261/api/" + path, {
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

function assertNotInternalError(status: number, body: { error?: { code?: string } }) {
  assert.notEqual(status, 500);
  assert.notEqual(body.error?.code, "internal_error");
}

test("GET /api/tasks happy path is 200 without degraded", async () => {
  const id = randomUUID();
  put("task", "workspace", {
    id,
    conversationId: randomUUID(),
    requestKey: randomUUID(),
    payloadHash: "fixture",
    state: "completed",
    transport: "chat",
    remoteId: null,
    input: "契約任務",
    attachments: [],
    output: "完成",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    error: null,
    observationError: null,
    events: [],
    usage: {
      model: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      durationMs: null,
      providerCost: null,
      toolCost: null,
    },
    stopSupported: false,
  });
  const response = await tasksApi.GET(request("tasks"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.degraded, undefined);
  assert.equal(body.error, undefined);
  assert.ok(Array.isArray(body.tasks));
  assert.ok(body.tasks.some((task: { id: string }) => task.id === id));
});

test("GET /api/tasks store list throw is not 500", async (t) => {
  t.after(() => mockStoreThrowForTests(null));
  mockStoreThrowForTests({
    list(kind) {
      if (kind === "task")
        throw new Error(
          "connect ECONNREFUSED postgres://user:" + LEAK + "@127.0.0.1:5432/db",
        );
    },
  });
  const response = await tasksApi.GET(request("tasks"));
  const body = await response.json();
  assertNotInternalError(response.status, body);
  assert.ok(response.status === 200 || response.status === 503);
  assert.ok(Array.isArray(body.tasks));
  assert.equal(body.tasks.length, 0);
  if (response.status === 200) {
    assert.equal(body.degraded, true);
    assert.equal(body.error?.code, "store_unavailable");
  } else {
    assert.equal(body.error?.code, "store_unavailable");
  }
  assertNoSecrets(body);
});

test("POST /api/tasks store throw stays 503 not internal_error", async (t) => {
  t.after(() => mockStoreThrowForTests(null));
  mockStoreThrowForTests({
    get() {
      throw new Error("pg get password=" + LEAK);
    },
    put() {
      throw new Error("pg write password=" + LEAK);
    },
  });
  const response = await tasksApi.POST(
    request("tasks", "POST", {
      conversationId: randomUUID(),
      requestKey: randomUUID(),
      input: "不應寫入",
    }),
  );
  const body = await response.json();
  assertNotInternalError(response.status, body);
  assert.equal(response.status, 503);
  assert.equal(body.error?.code, "store_unavailable");
  assert.equal(body.task, undefined);
  assertNoSecrets(body);
});

test("GET /api/agents happy path is 200 without degraded", async () => {
  const response = await agentsApi.GET(request("agents"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.degraded, undefined);
  assert.equal(body.error, undefined);
  assert.ok(Array.isArray(body.agents));
  assert.ok(body.agents.length > 0);
  assert.ok(body.agents.some((agent: { id: string }) => agent.id === "general"));
  assert.ok(Array.isArray(body.brain));
});

test("GET /api/agents store list throw is not 500", async (t) => {
  t.after(() => mockStoreThrowForTests(null));
  mockStoreThrowForTests({
    list() {
      throw new Error("pg list password=" + LEAK);
    },
  });
  const response = await agentsApi.GET(request("agents"));
  const body = await response.json();
  assertNotInternalError(response.status, body);
  assert.ok(response.status === 200 || response.status === 503);
  assert.ok(Array.isArray(body.agents));
  if (response.status === 200) {
    assert.equal(body.degraded, true);
    assert.equal(body.error?.code, "store_unavailable");
    assert.ok(
      body.agents.length === 0 ||
        body.agents.some((agent: { id: string }) => agent.id === "general"),
    );
  } else {
    assert.equal(body.error?.code, "store_unavailable");
  }
  assertNoSecrets(body);
});

test("GET /api/agents usage throw still returns agents without 500", async (t) => {
  t.after(() => mockStoreThrowForTests(null));
  mockStoreThrowForTests({
    list(kind) {
      if (kind === "usage_event")
        throw new Error("pg usage password=" + LEAK);
    },
  });
  const response = await agentsApi.GET(request("agents"));
  const body = await response.json();
  assertNotInternalError(response.status, body);
  assert.ok(response.status === 200 || response.status === 503);
  assert.ok(Array.isArray(body.agents));
  if (response.status === 200) {
    assert.ok(body.agents.some((agent: { id: string }) => agent.id === "general"));
    assert.equal(body.degraded, true);
    assert.equal(body.error?.code, "store_unavailable");
  }
  assertNoSecrets(body);
});

test("GET /api/brain happy path is 200 without internal_error", async () => {
  const response = await brainApi.GET(request("brain"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.degraded, undefined);
  assert.notEqual(body.error?.code, "internal_error");
  assert.equal(typeof body.supported, "boolean");
  if (body.supported === false) {
    assert.equal(
      body.reason,
      "目前 Hermes 實例未宣告 memory／session_search；不顯示 Agent Brain。",
    );
  }
});

test("GET /api/brain store throw is not 500", async (t) => {
  t.after(() => mockStoreThrowForTests(null));
  mockStoreThrowForTests({
    list() {
      throw new Error("pg list brain password=" + LEAK);
    },
    get() {
      throw new Error("pg get brain password=" + LEAK);
    },
  });
  const response = await brainApi.GET(request("brain"));
  const body = await response.json();
  assertNotInternalError(response.status, body);
  assert.ok(response.status === 200 || response.status === 503);
  assert.notEqual(body.error?.code, "internal_error");
  if (response.status === 200) {
    assert.equal(typeof body.supported, "boolean");
    if (body.degraded) {
      assert.equal(body.error?.code, "store_unavailable");
      if (body.supported === false) assert.equal(typeof body.reason, "string");
    }
  } else {
    assert.equal(body.error?.code, "store_unavailable");
  }
  assertNoSecrets(body);
});
