import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MessageChannel,
  receiveMessageOnPort,
  Worker,
  type MessagePort,
} from "node:worker_threads";
import "pg";

export type StoreBackend = "sqlite" | "postgres";

export const CONSOLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS console_records (
  kind TEXT NOT NULL,
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  value JSONB NOT NULL,
  rowid BIGSERIAL,
  PRIMARY KEY (kind, owner, id)
);
CREATE TABLE IF NOT EXISTS console_sessions (
  digest TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS console_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires BIGINT NOT NULL
);
`;

const runtimeStore = globalThis as typeof globalThis & {
  hermesDatabase?: DatabaseSync;
  hermesPg?: PgSync;
};

const SQLITE_SCHEMA = `
  PRAGMA journal_mode=WAL;
  PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS records (
    kind TEXT NOT NULL, owner TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY(kind,owner,id)
  );
  CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
  PRAGMA user_version=1;
`;

const PG_WORKER_SOURCE = `
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { Client } = require("pg");
const lock = new Int32Array(workerData.sab);
let client;
function redact(value) {
  return String(value || "postgres_failed")
    .replace(/postgres(?:ql)?:\\/\\/\\S+/gi, "postgres://[redacted]")
    .replace(/[A-Za-z0-9._%+-]+:[^@\\s]+@/g, "[redacted]@");
}
parentPort.once("message", ({ port }) => {
  port.on("message", async (msg) => {
    try {
      if (msg.type === "init") {
        client = new Client({
          connectionString: workerData.connectionString,
          connectionTimeoutMillis: 15000,
          query_timeout: 30000,
        });
        await client.connect();
        await client.query(msg.schema);
        port.postMessage({ ok: true });
      } else if (msg.type === "end") {
        if (client) await client.end();
        port.postMessage({ ok: true });
      } else {
        const result = await client.query(msg.sql, msg.params || []);
        port.postMessage({ rows: result.rows, rowCount: result.rowCount });
      }
    } catch (error) {
      port.postMessage({ error: redact(error && error.message) });
    }
    Atomics.store(lock, 0, 1);
    Atomics.notify(lock, 0);
  });
  Atomics.store(lock, 0, 1);
  Atomics.notify(lock, 0);
});
`;

type PgReply = {
  ok?: boolean;
  rows?: Record<string, unknown>[];
  rowCount?: number;
  error?: string;
};

const PG_STORE_BRAND = Symbol.for("hermes.console.pg-sync");

type PgQueryable = {
  query: (sql: string, params?: unknown[]) => unknown;
};

type SqliteExec = {
  exec: (sql: string) => unknown;
};

class PgSync {
  readonly [PG_STORE_BRAND] = true as const;
  private worker: Worker;
  private port: MessagePort;
  private lock: Int32Array;
  constructor(connectionString: string) {
    const sab = new SharedArrayBuffer(4);
    this.lock = new Int32Array(sab);
    this.worker = new Worker(PG_WORKER_SOURCE, {
      eval: true,
      execArgv: [],
      workerData: { sab, connectionString },
    });
    this.worker.once("error", () => this.release());
    this.worker.once("exit", () => this.release());
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    Atomics.store(this.lock, 0, 0);
    this.worker.postMessage({ port: port2 }, [port2]);
    try {
      this.wait();
      this.call({ type: "init", schema: CONSOLE_SCHEMA_SQL });
    } catch (error) {
      void this.worker.terminate();
      this.port.close();
      throw error;
    }
  }
  query(sql: string, params: unknown[] = []) {
    assertConsoleSql(sql);
    const reply = this.call({ type: "query", sql, params });
    return {
      rows: reply.rows || [],
      rowCount: Number(reply.rowCount || 0),
    };
  }
  terminate() {
    try {
      this.call({ type: "end" });
    } catch {
      /* still stop the worker */
    }
    void this.worker.terminate();
    this.port.close();
  }
  private call(message: Record<string, unknown>): PgReply {
    Atomics.store(this.lock, 0, 0);
    this.port.postMessage(message);
    this.wait();
    const reply = receiveMessageOnPort(this.port)?.message as PgReply | undefined;
    if (!reply) throw new Error("Console Postgres unavailable");
    if (reply.error) throw new Error(reply.error);
    return reply;
  }
  private wait() {
    if (Atomics.wait(this.lock, 0, 0, 20_000) === "timed-out")
      throw new Error("Console Postgres unavailable");
  }
  private release() {
    Atomics.store(this.lock, 0, 1);
    Atomics.notify(this.lock, 0);
  }
}

function postgresUrl() {
  // Blank / whitespace DATABASE_URL is unset: keep SQLite. Never treat empty as Postgres.
  const value = (process.env.DATABASE_URL || "").trim();
  if (!/^postgres(ql)?:\/\//i.test(value)) return "";
  if (process.env.CONSOLE_TEST_POSTGRES === "1") return value;
  if (process.env.NODE_TEST_CONTEXT) return "";
  return value;
}

function assertConsoleSql(sql: string) {
  if (/cutos_memory_items|\bai_os\b/i.test(sql))
    throw new Error("refusing non-console schema");
}

export function dataDir() {
  return resolve(process.env.CONSOLE_DATA_DIR || ".data");
}

export function sqliteFile() {
  return join(dataDir(), "console.sqlite");
}

export function storeBackend(): StoreBackend {
  return postgresUrl() ? "postgres" : "sqlite";
}

export type StoreProbe = {
  backend: StoreBackend;
  dataDir: string;
  ok: boolean;
};

export function probeStore(): StoreProbe {
  const backend = storeBackend();
  const dir = dataDir();
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (backend === "postgres") {
      const n = Number(pg().query("SELECT 1::int AS n").rows[0]?.n);
      if (n !== 1) throw new Error("postgres_probe_failed");
    } else {
      const n = Number(sqlite().prepare("SELECT 1 AS n").get()?.n);
      if (n !== 1) throw new Error("sqlite_probe_failed");
    }
    return { backend, dataDir: dir, ok: true };
  } catch {
    return { backend, dataDir: dir, ok: false };
  }
}

export function isPgStoreClient(database: unknown): database is PgQueryable {
  if (storeBackend() === "postgres") return true;
  if (!database || typeof database !== "object") return false;
  if (Reflect.get(database, PG_STORE_BRAND) === true) return true;
  if (typeof (database as { query?: unknown }).query === "function") return true;
  return false;
}

export function runStoreTransaction<T>(database: unknown, fn: () => T): T {
  if (isPgStoreClient(database)) {
    const client = database as PgQueryable;
    try {
      client.query("BEGIN");
      const value = fn();
      client.query("COMMIT");
      return value;
    } catch (error) {
      try {
        client.query("ROLLBACK");
      } catch {
        /* ROLLBACK can fail if BEGIN never started */
      }
      throw error;
    }
  }
  const sqlite = database as SqliteExec;
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    sqlite.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      sqlite.exec("ROLLBACK");
    } catch {
      /* ROLLBACK can fail if BEGIN never started */
    }
    throw error;
  }
}

function pg() {
  if (!runtimeStore.hermesPg) {
    const client = new PgSync(postgresUrl());
    try {
      migrateSqliteIntoPostgres(client);
    } catch (error) {
      client.terminate();
      throw error;
    }
    runtimeStore.hermesPg = client;
  }
  return runtimeStore.hermesPg;
}

function sqlite() {
  if (!runtimeStore.hermesDatabase) {
    mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    runtimeStore.hermesDatabase = new DatabaseSync(sqliteFile());
    runtimeStore.hermesDatabase.exec(SQLITE_SCHEMA);
    migrateLegacyOwner(runtimeStore.hermesDatabase);
  }
  return runtimeStore.hermesDatabase;
}

function backend() {
  return storeBackend() === "postgres" ? pg() : sqlite();
}

function migrateLegacyOwner(database: DatabaseSync) {
  const legacy = database
    .prepare("SELECT COUNT(*) AS n FROM records WHERE owner=?")
    .get("owner");
  const current = database
    .prepare("SELECT COUNT(*) AS n FROM records WHERE owner=?")
    .get("workspace");
  if (Number(legacy?.n || 0) > 0 && Number(current?.n || 0) === 0) {
    database
      .prepare("UPDATE records SET owner=? WHERE owner=?")
      .run("workspace", "owner");
  }
}

function sqliteTableNames(database: DatabaseSync) {
  return new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => String(row.name)),
  );
}

function migrateSqliteIntoPostgres(client: PgSync) {
  const path = sqliteFile();
  if (!existsSync(path)) return;
  const occupied =
    Number(client.query("SELECT COUNT(*)::int AS n FROM console_records").rows[0]?.n) +
      Number(client.query("SELECT COUNT(*)::int AS n FROM console_sessions").rows[0]?.n) +
      Number(client.query("SELECT COUNT(*)::int AS n FROM console_limits").rows[0]?.n) >
    0;
  if (occupied) return;
  const database = new DatabaseSync(path);
  try {
    database.exec(SQLITE_SCHEMA);
    migrateLegacyOwner(database);
    const tables = sqliteTableNames(database);
    client.query("BEGIN");
    try {
      if (tables.has("records")) {
        for (const row of database
          .prepare("SELECT kind, owner, id, value FROM records ORDER BY rowid ASC")
          .all()) {
          client.query(
            "INSERT INTO console_records(kind,owner,id,value) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT (kind,owner,id) DO NOTHING",
            [row.kind, row.owner, row.id, String(row.value)],
          );
        }
      }
      if (tables.has("sessions")) {
        for (const row of database
          .prepare("SELECT digest, owner, expires FROM sessions")
          .all()) {
          client.query(
            "INSERT INTO console_sessions(digest,owner,expires) VALUES($1,$2,$3) ON CONFLICT (digest) DO NOTHING",
            [row.digest, row.owner, Number(row.expires)],
          );
        }
      }
      if (tables.has("limits")) {
        for (const row of database
          .prepare("SELECT key, count, expires FROM limits")
          .all()) {
          client.query(
            "INSERT INTO console_limits(key,count,expires) VALUES($1,$2,$3) ON CONFLICT (key) DO NOTHING",
            [row.key, Number(row.count), Number(row.expires)],
          );
        }
      }
      client.query("COMMIT");
    } catch (error) {
      client.query("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

function parseValue<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

type StoreFault = Partial<{
  list: (kind: string, owner: string) => void;
  get: (kind: string, owner: string, id: string) => void;
  put: (kind: string, owner: string, value: { id: string }) => void;
  remove: (kind: string, owner: string, id: string) => void;
}>;

let storeFault: StoreFault | null = null;

/** Test-only: make get/list/put/remove throw before touching sqlite/pg. */
export function mockStoreThrowForTests(fault: StoreFault | null) {
  if (!process.env.NODE_TEST_CONTEXT) return;
  storeFault = fault;
}

export function get<T>(kind: string, owner: string, id: string): T | null {
  storeFault?.get?.(kind, owner, id);
  if (storeBackend() === "postgres") {
    const row = pg().query(
      "SELECT value FROM console_records WHERE kind=$1 AND owner=$2 AND id=$3",
      [kind, owner, id],
    ).rows[0];
    return row ? parseValue<T>(row.value) : null;
  }
  const row = sqlite()
    .prepare("SELECT value FROM records WHERE kind=? AND owner=? AND id=?")
    .get(kind, owner, id);
  return row ? (JSON.parse(String(row.value)) as T) : null;
}

export function list<T>(kind: string, owner: string): T[] {
  storeFault?.list?.(kind, owner);
  if (storeBackend() === "postgres") {
    return pg()
      .query(
        "SELECT value FROM console_records WHERE kind=$1 AND owner=$2 ORDER BY rowid DESC",
        [kind, owner],
      )
      .rows.map((row) => parseValue<T>(row.value));
  }
  return sqlite()
    .prepare(
      "SELECT value FROM records WHERE kind=? AND owner=? ORDER BY rowid DESC",
    )
    .all(kind, owner)
    .map((r) => JSON.parse(String(r.value)) as T);
}

export function put<T extends { id: string }>(
  kind: string,
  owner: string,
  value: T,
) {
  storeFault?.put?.(kind, owner, value);
  if (storeBackend() === "postgres") {
    pg().query(
      "INSERT INTO console_records(kind,owner,id,value) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT (kind,owner,id) DO UPDATE SET value=EXCLUDED.value",
      [kind, owner, value.id, JSON.stringify(value)],
    );
    return value;
  }
  sqlite()
    .prepare(
      "INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,owner,id) DO UPDATE SET value=excluded.value",
    )
    .run(kind, owner, value.id, JSON.stringify(value));
  return value;
}

export function remove(kind: string, owner: string, id: string) {
  storeFault?.remove?.(kind, owner, id);
  if (storeBackend() === "postgres") {
    return (
      pg().query(
        "DELETE FROM console_records WHERE kind=$1 AND owner=$2 AND id=$3",
        [kind, owner, id],
      ).rowCount > 0
    );
  }
  const result = sqlite()
    .prepare("DELETE FROM records WHERE kind=? AND owner=? AND id=?")
    .run(kind, owner, id);
  return Number(result.changes) > 0;
}

export function transaction<T>(fn: () => T): T {
  return runStoreTransaction(backend(), fn);
}

export function hitLimit(key: string, windowMs: number) {
  const now = Date.now();
  const expires = now + windowMs;
  if (storeBackend() === "postgres") {
    pg().query("DELETE FROM console_limits WHERE expires < $1", [now]);
    pg().query(
      "INSERT INTO console_limits(key,count,expires) VALUES($1,1,$2) ON CONFLICT (key) DO UPDATE SET count=console_limits.count+1",
      [key, expires],
    );
    return Number(
      pg().query("SELECT count FROM console_limits WHERE key=$1", [key]).rows[0]
        ?.count,
    );
  }
  const database = sqlite();
  database.prepare("DELETE FROM limits WHERE expires < ?").run(now);
  database
    .prepare(
      "INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
    )
    .run(key, expires);
  return Number(
    database.prepare("SELECT count FROM limits WHERE key=?").get(key)!.count,
  );
}

export function createSession(digest: string, owner: string, expires: number) {
  const now = Date.now();
  if (storeBackend() === "postgres") {
    pg().query("DELETE FROM console_sessions WHERE expires < $1", [now]);
    pg().query(
      "INSERT INTO console_sessions(digest,owner,expires) VALUES($1,$2,$3)",
      [digest, owner, expires],
    );
    return;
  }
  const database = sqlite();
  database.prepare("DELETE FROM sessions WHERE expires < ?").run(now);
  database
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(digest, owner, expires);
}

export function resetStoreForTests() {
  if (!process.env.NODE_TEST_CONTEXT) return;
  storeFault = null;
  runtimeStore.hermesDatabase?.close();
  delete runtimeStore.hermesDatabase;
  runtimeStore.hermesPg?.terminate();
  delete runtimeStore.hermesPg;
}
