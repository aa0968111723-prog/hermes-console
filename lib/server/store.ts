import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const runtimeStore = globalThis as typeof globalThis & {
  hermesDatabase?: DatabaseSync;
};
export function dataDir() {
  return resolve(process.env.CONSOLE_DATA_DIR || ".data");
}
export function db() {
  if (!runtimeStore.hermesDatabase) {
    mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    runtimeStore.hermesDatabase = new DatabaseSync(
      join(dataDir(), "console.sqlite"),
    );
    runtimeStore.hermesDatabase.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL, owner TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY(kind,owner,id)
      );
      CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
      PRAGMA user_version=1;
    `);
    migrateLegacyOwner(runtimeStore.hermesDatabase);
  }
  return runtimeStore.hermesDatabase;
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
export function remove(kind: string, owner: string, id: string) {
  const result = db()
    .prepare("DELETE FROM records WHERE kind=? AND owner=? AND id=?")
    .run(kind, owner, id);
  return Number(result.changes) > 0;
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
