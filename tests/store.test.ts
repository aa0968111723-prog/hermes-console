import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-store-"));
const pgUrl = (process.env.DATABASE_URL || "").trim();
const livePostgres = process.env.CONSOLE_TEST_POSTGRES === "1";
delete process.env.CONSOLE_TEST_POSTGRES;

const {
  CONSOLE_SCHEMA_SQL,
  createSession,
  get,
  hitLimit,
  list,
  put,
  remove,
  resetStoreForTests,
  storeBackend,
  transaction,
} = await import("../lib/server/store");

test("console store uses sqlite without DATABASE_URL and never ai_os schemas", async (t) => {
  await t.test("schema is Hermes-owned console_* jsonb tables", () => {
    assert.match(CONSOLE_SCHEMA_SQL, /console_records/);
    assert.match(CONSOLE_SCHEMA_SQL, /console_sessions/);
    assert.match(CONSOLE_SCHEMA_SQL, /console_limits/);
    assert.match(CONSOLE_SCHEMA_SQL, /jsonb/i);
    assert.doesNotMatch(CONSOLE_SCHEMA_SQL, /cutos_memory_items/);
    assert.doesNotMatch(CONSOLE_SCHEMA_SQL, /\bai_os\b/i);
  });

  await t.test("sqlite is the default backend in contract tests", () => {
    process.env.DATABASE_URL = "postgres://example.invalid/db";
    assert.equal(storeBackend(), "sqlite");
    delete process.env.DATABASE_URL;
    assert.equal(storeBackend(), "sqlite");
  });

  await t.test("migrates all record kinds including shared_memory", () => {
    put("shared_memory", "workspace", {
      id: "mem-1",
      title: "共用",
      content: "同一 records 表",
    });
    put("project", "workspace", { id: "proj-1", name: "專案" });
    put("conversation", "workspace", { id: "conv-1", title: "對話" });
    assert.equal(
      get<{ title: string }>("shared_memory", "workspace", "mem-1")?.title,
      "共用",
    );
    assert.equal(list<{ name: string }>("project", "workspace")[0].name, "專案");
    assert.equal(
      list<{ title: string }>("conversation", "workspace")[0].title,
      "對話",
    );
    assert.equal(remove("project", "workspace", "proj-1"), true);
    assert.equal(get("project", "workspace", "proj-1"), null);
  });

  await t.test("transaction rolls back", () => {
    put("note", "workspace", { id: "keep", body: "ok" });
    assert.throws(() =>
      transaction(() => {
        put("note", "workspace", { id: "gone", body: "no" });
        throw new Error("boom");
      }),
    );
    assert.equal(get<{ body: string }>("note", "workspace", "keep")?.body, "ok");
    assert.equal(get("note", "workspace", "gone"), null);
  });

  await t.test("sessions and limits stay on the same backend", () => {
    createSession("digest-1", "owner", Date.now() + 60_000);
    assert.equal(hitLimit("k", 60_000), 1);
    assert.equal(hitLimit("k", 60_000), 2);
  });
});

test("postgres CRUD when DATABASE_URL and CONSOLE_TEST_POSTGRES=1", { skip: !livePostgres || !/^postgres(ql)?:\/\//i.test(pgUrl) }, async () => {
  process.env.CONSOLE_TEST_POSTGRES = "1";
  process.env.DATABASE_URL = pgUrl;
  resetStoreForTests();
  assert.equal(storeBackend(), "postgres");
  const id = randomUUID();
  put("shared_memory", "workspace", { id, title: "pg-shared" });
  put("project", "workspace", { id: "p-" + id, name: "pg-project" });
  assert.equal(
    get<{ title: string }>("shared_memory", "workspace", id)?.title,
    "pg-shared",
  );
  assert.equal(remove("shared_memory", "workspace", id), true);
  assert.equal(remove("project", "workspace", "p-" + id), true);
  resetStoreForTests();
  delete process.env.CONSOLE_TEST_POSTGRES;
});

test("postgres secrets are not echoed when the driver cannot connect", async (t) => {
  const previous = process.env.DATABASE_URL;
  process.env.CONSOLE_TEST_POSTGRES = "1";
  process.env.DATABASE_URL = "postgres://user:secret-token@127.0.0.1:1/db";
  resetStoreForTests();
  await t.test("connection failure omits credentials", () => {
    assert.throws(
      () => get("shared_memory", "workspace", randomUUID()),
      (error: Error) => {
        const text = String(error.message || error);
        assert.doesNotMatch(text, /secret-token/);
        assert.doesNotMatch(text, /postgres:\/\/user:secret-token/);
        return true;
      },
    );
  });
  resetStoreForTests();
  delete process.env.CONSOLE_TEST_POSTGRES;
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
});
