#!/usr/bin/env node
/**
 * Import Tamkang club ecosystem snapshot into Hermes Console SQLite fallback.
 * Source of truth in git: data/tamkang/records.seed.json
 * Runtime SQLite (gitignored): $CONSOLE_DATA_DIR/console.sqlite
 * If DATABASE_URL Postgres is already primary, import into SQLite will not copy
 * again (one-shot migrate only when Postgres is empty).
 */
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seedPath = resolve(root, "data/tamkang/records.seed.json");
const dataDir = resolve(process.env.CONSOLE_DATA_DIR || join(root, ".data"));
const dbPath = join(dataDir, "console.sqlite");

if (!existsSync(seedPath)) {
  console.error("missing seed:", seedPath);
  process.exit(1);
}

const rows = JSON.parse(readFileSync(seedPath, "utf8"));
if (!Array.isArray(rows)) {
  console.error("seed must be an array of {kind,owner,id,value}");
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS records (
    kind TEXT NOT NULL, owner TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY(kind,owner,id)
  );
`);

const upsert = db.prepare(
  "INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,owner,id) DO UPDATE SET value=excluded.value",
);

db.exec("BEGIN IMMEDIATE");
let n = 0;
for (const row of rows) {
  if (!row?.kind || !row?.id) continue;
  const owner = row.owner || "workspace";
  const value = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
  upsert.run(row.kind, owner, String(row.id), value);
  n += 1;
}
db.exec("COMMIT");
db.close();

console.log(`imported ${n} records → ${dbPath}`);
