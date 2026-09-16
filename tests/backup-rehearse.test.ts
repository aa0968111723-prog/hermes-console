import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = await mkdtemp(join(tmpdir(), "hermes-backup-"));
process.env.CONSOLE_DATA_DIR = dataDir;
process.env.CONSOLE_ORIGIN = "http://localhost:3262";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
delete process.env.DATABASE_URL;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;

const { resetStoreForTests } = await import("../lib/server/store");
const { createBackup } = await import("../lib/server/backup");
const { rehearsalReport } = await import("../lib/server/rehearse");

test("backup copies sqlite and vault without echoing the key", async () => {
  const key = "a".repeat(64);
  await writeFile(join(dataDir, "vault.key"), key, {
    encoding: "utf8",
    mode: 0o600,
  });
  await writeFile(join(dataDir, "console.sqlite"), "sqlite-fixture", {
    encoding: "utf8",
    mode: 0o600,
  });
  const dest = join(dataDir, "backup-out");
  const result = createBackup(dest);
  assert.equal(result.ok, true);
  assert.ok(result.files.includes("console.sqlite"));
  assert.ok(result.files.includes("vault.key"));
  assert.ok(result.files.includes("manifest.json"));
  assert.equal(result.message.includes(key), false);
  const copied = await readFile(join(dest, "vault.key"), "utf8");
  assert.equal(copied, key);
  const manifest = await readFile(join(dest, "manifest.json"), "utf8");
  assert.equal(manifest.includes(key), false);
});

test("rehearsal reports unconfigured services without secret values", () => {
  resetStoreForTests();
  const secret = "rehearse-secret-value-do-not-print";
  process.env.GOOGLE_CLIENT_SECRET = secret;
  try {
    const report = rehearsalReport();
    assert.equal(typeof report.ok, "boolean");
    const google = report.services.find((item) => item.id === "google");
    assert.equal(google?.configured, false);
    const hermes = report.services.find((item) => item.id === "hermes");
    assert.equal(hermes?.configured, false);
    assert.equal(JSON.stringify(report).includes(secret), false);
  } finally {
    delete process.env.GOOGLE_CLIENT_SECRET;
  }
});
