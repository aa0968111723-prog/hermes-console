import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = await mkdtemp(join(tmpdir(), "hermes-backup-src-"));
process.env.CONSOLE_DATA_DIR = source;
delete process.env.DATABASE_URL;

await writeFile(join(source, "console.sqlite"), "sqlite-bytes");
await writeFile(join(source, "vault.key"), "a".repeat(64));
await mkdir(join(source, "uploads", "workspace"), { recursive: true });
await writeFile(join(source, "uploads", "workspace", "file.bin"), "blob");

const { runDataBackup } = await import("../lib/server/backup");

test("sqlite backup copies data dir files without echoing secrets", async () => {
  const dest = await mkdtemp(join(tmpdir(), "hermes-backup-dst-"));
  const result = runDataBackup(dest, new Date("2026-09-16T06:00:00.000Z"));
  assert.equal(result.backend, "sqlite");
  assert.equal(result.postgresNote, null);
  assert.deepEqual(result.copied.sort(), [
    "console.sqlite",
    "uploads",
    "vault.key",
  ]);
  assert.equal(
    await readFile(join(result.destination, "console.sqlite"), "utf8"),
    "sqlite-bytes",
  );
  assert.equal(
    (await readFile(join(result.destination, "vault.key"), "utf8")).length,
    64,
  );
  assert.equal(
    await readFile(
      join(result.destination, "uploads", "workspace", "file.bin"),
      "utf8",
    ),
    "blob",
  );
  assert.doesNotMatch(JSON.stringify(result), /aaaaaaaa/);
});

test("postgres backup asks for pg_dump and never prints DATABASE_URL", async () => {
  process.env.DATABASE_URL = "postgres://user:super-secret@db.example/hermes";
  const dest = await mkdtemp(join(tmpdir(), "hermes-backup-pg-"));
  const result = runDataBackup(dest, new Date("2026-09-16T06:01:00.000Z"));
  assert.equal(result.backend, "postgres");
  assert.match(result.postgresNote || "", /pg_dump/);
  assert.doesNotMatch(result.postgresNote || "", /super-secret/);
  assert.doesNotMatch(JSON.stringify(result), /super-secret|db\.example/);
  delete process.env.DATABASE_URL;
});
