import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const runtimeStore = globalThis as typeof globalThis & {
  hermesDatabase?: DatabaseSync;
};
export function dataDir() {
  return resolve(process.env.CONSOLE_DATA_DIR || ".data");
}
export function db(): DatabaseSync {
  if (!runtimeStore.hermesDatabase) {
    mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    const dbPath = join(dataDir(), "console.sqlite");

    let retries = 5;
    while (retries > 0) {
      try {
        const database = new DatabaseSync(dbPath);
        database.exec("PRAGMA busy_timeout=10000;");
        try {
          database.exec("PRAGMA journal_mode=WAL;");
        } catch {
          // WAL 模式可能已由其他行程啟用或處於讀取鎖，不阻塞初始化
        }
        database.exec(`
          CREATE TABLE IF NOT EXISTS records (
            kind TEXT NOT NULL, owner TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
            PRIMARY KEY(kind,owner,id)
          );
          CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
          PRAGMA user_version=1;
        `);
        migrateLegacyOwner(database);
        runtimeStore.hermesDatabase = database;
        break;
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        if (
          (error?.code === "ERR_SQLITE_ERROR" ||
            error?.message?.includes("locked") ||
            error?.message?.includes("busy")) &&
          retries > 1
        ) {
          retries--;
          const sleepMs = Math.floor(Math.random() * 100) + 50;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
          continue;
        }
        throw err;
      }
    }
  }
  return runtimeStore.hermesDatabase!;
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
export function get<T>(kind: string, owner: string, id: string): T | null {
  const row = db()
    .prepare("SELECT value FROM records WHERE kind=? AND owner=? AND id=?")
    .get(kind, owner, id);
  return row ? (JSON.parse(String(row.value)) as T) : null;
}
export function list<T>(kind: string, owner: string): T[] {
  return db()
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
  db()
    .prepare(
      "INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,owner,id) DO UPDATE SET value=excluded.value",
    )
    .run(kind, owner, value.id, JSON.stringify(value));
  return value;
}
export function del(kind: string, owner: string, id: string) {
  db()
    .prepare("DELETE FROM records WHERE kind=? AND owner=? AND id=?")
    .run(kind, owner, id);
}
export function transaction<T>(fn: () => T): T {
  db().exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db().exec("COMMIT");
    return value;
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
}
