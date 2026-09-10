import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-pg-stale-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3291";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
delete process.env.DATABASE_URL;
delete process.env.CONSOLE_TEST_POSTGRES;

const {
  classifyPgReply,
  StoreUnavailableError,
  mockStoreThrowForTests,
  put,
  get,
  list,
  resetStoreForTests,
} = await import("../lib/server/store");
const conversations = await import("../app/api/conversations/route");
const workspace = await import("../app/api/workspace/route");

function request(path: string, method = "GET", body?: unknown) {
  return new Request("http://localhost:3291/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("past bug: postgres worker leftover reply classified as stale, not success", () => {
  assert.equal(classifyPgReply(2, undefined), "empty");
  assert.equal(classifyPgReply(2, { id: 1 }), "stale");
  assert.equal(classifyPgReply(2, { id: 2 }), "accept");
  assert.equal(classifyPgReply(2, {}), "accept");
});

test("past bug: production POST /api/conversations 201 then GET 404", async () => {
  resetStoreForTests();
  const created = await conversations.POST(
    request("conversations", "POST", { title: "115-1 期初", projectId: "personal" }),
  );
  assert.equal(created.status, 201);
  const body = await created.json();
  const id = body.conversation?.id as string;
  assert.match(id, /^[0-9a-f-]{36}$/i);
  assert.equal(get<{ id: string }>("conversation", "workspace", id)?.id, id);

  const fetched = await conversations.GET(request("conversations?id=" + id));
  assert.equal(fetched.status, 200);
  const again = await fetched.json();
  assert.equal(again.conversation.id, id);
  assert.equal(again.conversation.title, "115-1 期初");
});

test("past bug: workspace GET 500 instead of 503 when store is down", async () => {
  resetStoreForTests();
  mockStoreThrowForTests({
    list: () => {
      throw new StoreUnavailableError();
    },
  });
  try {
    const response = await workspace.GET(request("workspace"));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "store_unavailable");
    assert.equal(body.error.message, "儲存庫無法使用。");
    assert.doesNotMatch(JSON.stringify(body), /postgres(?:ql)?:\/\/\S+/i);
  } finally {
    mockStoreThrowForTests(null);
    resetStoreForTests();
  }
});

test("list drops JSON null rows instead of returning [null]", () => {
  resetStoreForTests();
  const id = randomUUID();
  put("inspiration", "workspace", { id, title: "keep" });
  assert.deepEqual(
    list<{ id: string }>("inspiration", "workspace").map((row) => row.id),
    [id],
  );
  assert.equal(
    list<{ id: string }>("inspiration", "workspace").includes(null as never),
    false,
  );
});
