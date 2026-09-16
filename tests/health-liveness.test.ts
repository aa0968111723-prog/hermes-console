import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { seedSession } from "./session-fixture";

const dataDir = await mkdtemp(join(tmpdir(), "hermes-liveness-"));
process.env.CONSOLE_DATA_DIR = dataDir;
process.env.CONSOLE_ORIGIN = "http://localhost:3261";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
delete process.env.DATABASE_URL;
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;

const { resetStoreForTests } = await import("../lib/server/store");
const healthRoute = await import("../app/api/health/route");
const workspaceRoute = await import("../app/api/workspace/route");
const conversationsRoute = await import("../app/api/conversations/route");
const memoryRoute = await import("../app/api/memory/route");
const { ensureHermesReady } = await import("../lib/server/hermes");
const tasksRoute = await import("../app/api/tasks/route");

function request(
  path: string,
  cookie = "",
  method = "GET",
  body?: unknown,
) {
  return new Request("http://localhost:3261/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function hangingHermes() {
  const server = createServer(() => {
    /* never respond — discovery would wait on this */
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: "http://127.0.0.1:" + port };
}

async function unauthorizedHermes() {
  const server = createServer((_req, res) => {
    res.writeHead(401).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: "http://127.0.0.1:" + port };
}

function restoreHermesEnv(previous: {
  url?: string;
  key?: string;
  loopback?: string;
  connect?: string;
  discovery?: string;
}) {
  if (previous.url === undefined) delete process.env.HERMES_API_URL;
  else process.env.HERMES_API_URL = previous.url;
  if (previous.key === undefined) delete process.env.HERMES_API_KEY;
  else process.env.HERMES_API_KEY = previous.key;
  if (previous.loopback === undefined)
    delete process.env.HERMES_ALLOW_LOOPBACK_HTTP;
  else process.env.HERMES_ALLOW_LOOPBACK_HTTP = previous.loopback;
  if (previous.connect === undefined)
    delete process.env.HERMES_CONNECT_TIMEOUT_MS;
  else process.env.HERMES_CONNECT_TIMEOUT_MS = previous.connect;
  if (previous.discovery === undefined)
    delete process.env.HERMES_DISCOVERY_TIMEOUT_MS;
  else process.env.HERMES_DISCOVERY_TIMEOUT_MS = previous.discovery;
}

test("GET /api/health stays live without waiting on Hermes", async () => {
  const hanging = await hangingHermes();
  const previous = {
    url: process.env.HERMES_API_URL,
    key: process.env.HERMES_API_KEY,
    loopback: process.env.HERMES_ALLOW_LOOPBACK_HTTP,
    timeout: process.env.HERMES_DISCOVERY_TIMEOUT_MS,
  };
  process.env.HERMES_API_URL = hanging.url;
  process.env.HERMES_API_KEY = "liveness-probe-key-not-a-secret";
  process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
  process.env.HERMES_DISCOVERY_TIMEOUT_MS = "20000";
  resetStoreForTests();
  try {
    const started = Date.now();
    const response = await healthRoute.GET(request("health"));
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1500, "health GET blocked for " + elapsed + "ms");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.live, true);
    assert.equal(body.ready, true);
    assert.equal(body.agentReady, false);
    assert.equal(body.status, "verifying");
    assert.equal(body.reachable, null);
    assert.notEqual(body.status, "available");
    assert.equal(body.configSource, undefined);
  } finally {
    hanging.server.close();
    if (previous.url === undefined) delete process.env.HERMES_API_URL;
    else process.env.HERMES_API_URL = previous.url;
    if (previous.key === undefined) delete process.env.HERMES_API_KEY;
    else process.env.HERMES_API_KEY = previous.key;
    if (previous.loopback === undefined) delete process.env.HERMES_ALLOW_LOOPBACK_HTTP;
    else process.env.HERMES_ALLOW_LOOPBACK_HTTP = previous.loopback;
    if (previous.timeout === undefined) delete process.env.HERMES_DISCOVERY_TIMEOUT_MS;
    else process.env.HERMES_DISCOVERY_TIMEOUT_MS = previous.timeout;
    resetStoreForTests();
  }
});

test("GET /api/workspace does not wait on an unreachable Hermes", async () => {
  const hanging = await hangingHermes();
  process.env.HERMES_API_URL = hanging.url;
  process.env.HERMES_API_KEY = "liveness-probe-key-not-a-secret";
  process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
  process.env.HERMES_DISCOVERY_TIMEOUT_MS = "20000";
  resetStoreForTests();
  const { cookie } = seedSession();
  try {
    const started = Date.now();
    const response = await workspaceRoute.GET(request("workspace", cookie));
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1500, "workspace GET blocked for " + elapsed + "ms");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.memory.status, "unknown");
    assert.equal(body.memory.hermesRemote, "unknown");
  } finally {
    hanging.server.close();
    delete process.env.HERMES_API_URL;
    delete process.env.HERMES_API_KEY;
    delete process.env.HERMES_ALLOW_LOOPBACK_HTTP;
    delete process.env.HERMES_DISCOVERY_TIMEOUT_MS;
    resetStoreForTests();
  }
});

test("GET /api/health stays 200 when the store probe fails", async () => {
  const { randomUUID } = await import("node:crypto");
  const blocked = join(tmpdir(), "hermes-liveness-blocked-" + randomUUID());
  await writeFile(blocked, "not-a-directory");
  const previous = process.env.CONSOLE_DATA_DIR;
  process.env.CONSOLE_DATA_DIR = blocked;
  resetStoreForTests();
  try {
    const response = await healthRoute.GET(request("health"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.live, true);
    assert.equal(body.ready, false);
    assert.equal(body.storeReady, false);
    assert.equal(body.agentReady, false);
  } finally {
    process.env.CONSOLE_DATA_DIR = previous;
    resetStoreForTests();
  }
});

test("memory and local conversation reads do not wait on Hermes", async () => {
  const hanging = await hangingHermes();
  process.env.HERMES_API_URL = hanging.url;
  process.env.HERMES_API_KEY = "liveness-probe-key-not-a-secret";
  process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
  process.env.HERMES_DISCOVERY_TIMEOUT_MS = "20000";
  resetStoreForTests();
  const { cookie } = seedSession();
  try {
    const created = await conversationsRoute.POST(
      request("conversations", cookie, "POST", { title: "茶會" }),
    );
    assert.equal(created.status, 201);
    const id = (await created.json()).conversation.id;
    const started = Date.now();
    const [memory, conversation] = await Promise.all([
      memoryRoute.GET(request("memory?scope=all", cookie)),
      conversationsRoute.GET(request("conversations?id=" + id, cookie)),
    ]);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1500, "reads blocked for " + elapsed + "ms");
    assert.equal(memory.status, 200);
    assert.equal((await memory.json()).share.hermesRemote, "unknown");
    assert.equal(conversation.status, 200);
    const body = await conversation.json();
    assert.equal(body.syncStatus, "unsupported");
    assert.equal(body.remoteHistory, null);
  } finally {
    hanging.server.close();
    delete process.env.HERMES_API_URL;
    delete process.env.HERMES_API_KEY;
    delete process.env.HERMES_ALLOW_LOOPBACK_HTTP;
    delete process.env.HERMES_DISCOVERY_TIMEOUT_MS;
    resetStoreForTests();
  }
});

test("ensureHermesReady fails closed on unconfigured without probing", async () => {
  delete process.env.HERMES_API_URL;
  delete process.env.HERMES_API_KEY;
  const started = Date.now();
  const state = await ensureHermesReady("workspace");
  assert.ok(Date.now() - started < 500);
  assert.equal(state.credential, "missing");
  assert.equal(state.status, "unconfigured");
  assert.equal(state.message, "Hermes 還沒連上。請到設定的連線頁。");
});

test("GET /api/health unconfigured message stays student-safe", async () => {
  delete process.env.HERMES_API_URL;
  delete process.env.HERMES_API_KEY;
  resetStoreForTests();
  const response = await healthRoute.GET(request("health"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.message, "Hermes 還沒連上。請到設定的連線頁。");
  assert.doesNotMatch(String(body.message), /環境變數|HERMES_API/);
});

test("ensureHermesReady times out hanging Hermes without catalog wait", async () => {
  const hanging = await hangingHermes();
  const previous = {
    url: process.env.HERMES_API_URL,
    key: process.env.HERMES_API_KEY,
    loopback: process.env.HERMES_ALLOW_LOOPBACK_HTTP,
    connect: process.env.HERMES_CONNECT_TIMEOUT_MS,
    discovery: process.env.HERMES_DISCOVERY_TIMEOUT_MS,
  };
  process.env.HERMES_API_URL = hanging.url;
  process.env.HERMES_API_KEY = "liveness-probe-key-not-a-secret";
  process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
  process.env.HERMES_CONNECT_TIMEOUT_MS = "1000";
  process.env.HERMES_DISCOVERY_TIMEOUT_MS = "20000";
  resetStoreForTests();
  try {
    const started = Date.now();
    const state = await ensureHermesReady("workspace");
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2500, "ensureHermesReady blocked for " + elapsed + "ms");
    assert.equal(state.status, "failed");
    assert.notEqual(state.credential, "valid");
    assert.equal(state.message, "現在沒辦法連到 Hermes。");
    assert.doesNotMatch(state.message, /環境變數|HERMES_API|憑證參照/);
  } finally {
    hanging.server.close();
    if (previous.url === undefined) delete process.env.HERMES_API_URL;
    else process.env.HERMES_API_URL = previous.url;
    if (previous.key === undefined) delete process.env.HERMES_API_KEY;
    else process.env.HERMES_API_KEY = previous.key;
    if (previous.loopback === undefined)
      delete process.env.HERMES_ALLOW_LOOPBACK_HTTP;
    else process.env.HERMES_ALLOW_LOOPBACK_HTTP = previous.loopback;
    if (previous.connect === undefined)
      delete process.env.HERMES_CONNECT_TIMEOUT_MS;
    else process.env.HERMES_CONNECT_TIMEOUT_MS = previous.connect;
    if (previous.discovery === undefined)
      delete process.env.HERMES_DISCOVERY_TIMEOUT_MS;
    else process.env.HERMES_DISCOVERY_TIMEOUT_MS = previous.discovery;
    resetStoreForTests();
  }
});

test("POST /api/tasks returns student copy when Hermes is unconfigured", async () => {
  delete process.env.HERMES_API_URL;
  delete process.env.HERMES_API_KEY;
  resetStoreForTests();
  const { cookie } = seedSession();
  const created = await conversationsRoute.POST(
    request("conversations", cookie, "POST", { title: "茶會" }),
  );
  assert.equal(created.status, 201);
  const conversationId = (await created.json()).conversation.id;
  const response = await tasksRoute.POST(
    request("tasks", cookie, "POST", {
      conversationId,
      requestKey: randomUUID(),
      input: "幫我找淡大禪學社茶會宣傳靈感",
    }),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error?.code, "hermes_not_ready");
  assert.equal(body.error?.message, "Hermes 還沒連上。請到設定的連線頁。");
  assert.equal(body.error?.taxonomy, "UPSTREAM_ERROR");
  assert.doesNotMatch(JSON.stringify(body), /環境變數|HERMES_API/);
});

test("POST /api/tasks times out hanging Hermes with student copy", async () => {
  const hanging = await hangingHermes();
  const previous = {
    url: process.env.HERMES_API_URL,
    key: process.env.HERMES_API_KEY,
    loopback: process.env.HERMES_ALLOW_LOOPBACK_HTTP,
    connect: process.env.HERMES_CONNECT_TIMEOUT_MS,
    discovery: process.env.HERMES_DISCOVERY_TIMEOUT_MS,
  };
  process.env.HERMES_API_URL = hanging.url;
  process.env.HERMES_API_KEY = "liveness-probe-key-not-a-secret";
  process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
  process.env.HERMES_CONNECT_TIMEOUT_MS = "1000";
  process.env.HERMES_DISCOVERY_TIMEOUT_MS = "20000";
  resetStoreForTests();
  const { cookie } = seedSession();
  try {
    const created = await conversationsRoute.POST(
      request("conversations", cookie, "POST", { title: "茶會" }),
    );
    assert.equal(created.status, 201);
    const conversationId = (await created.json()).conversation.id;
    const started = Date.now();
    const response = await tasksRoute.POST(
      request("tasks", cookie, "POST", {
        conversationId,
        requestKey: randomUUID(),
        input: "幫我找淡大禪學社茶會宣傳靈感",
      }),
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2500, "POST /api/tasks blocked for " + elapsed + "ms");
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error?.code, "hermes_not_ready");
    assert.equal(body.error?.message, "現在沒辦法連到 Hermes。");
    assert.doesNotMatch(JSON.stringify(body), /環境變數|HERMES_API|金鑰|後端/);
  } finally {
    hanging.server.close();
    restoreHermesEnv(previous);
    resetStoreForTests();
  }
});

test("POST /api/tasks maps invalid Hermes keys to student copy", async () => {
  const rejected = await unauthorizedHermes();
  const previous = {
    url: process.env.HERMES_API_URL,
    key: process.env.HERMES_API_KEY,
    loopback: process.env.HERMES_ALLOW_LOOPBACK_HTTP,
  };
  process.env.HERMES_API_URL = rejected.url;
  process.env.HERMES_API_KEY = "liveness-probe-key-not-a-secret";
  process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
  resetStoreForTests();
  const { cookie } = seedSession();
  try {
    const created = await conversationsRoute.POST(
      request("conversations", cookie, "POST", { title: "茶會" }),
    );
    assert.equal(created.status, 201);
    const conversationId = (await created.json()).conversation.id;
    const response = await tasksRoute.POST(
      request("tasks", cookie, "POST", {
        conversationId,
        requestKey: randomUUID(),
        input: "幫我找淡大禪學社茶會宣傳靈感",
      }),
    );
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error?.code, "hermes_not_ready");
    assert.equal(body.error?.message, "Hermes 還沒連上。請到設定的連線頁。");
    assert.doesNotMatch(JSON.stringify(body), /金鑰|後端|環境變數|HERMES_API/);
  } finally {
    rejected.server.close();
    restoreHermesEnv(previous);
    resetStoreForTests();
  }
});

test("workspace settings keep DATABASE_URL off the student tab", async () => {
  const text = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(text, /DATABASE_URL/);
  assert.match(text, /記憶存在這個工作區/);
  assert.match(text, /connection-label sr-only/);
  assert.match(text, /shortTaskError\(currentTask\.error\)/);
  assert.match(text, /不會假裝已看過圖片/);
  assert.doesNotMatch(text, /部署端尚未驗證圖片輸入/);
});
