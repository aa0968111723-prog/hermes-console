import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-materials-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3261";

const { ApiError } = await import("../lib/server/security");
const { saveUpload } = await import("../lib/server/materials");
const { put } = await import("../lib/server/store");

test("saveUpload rejects forged PDF magic bytes", async () => {
  await assert.rejects(
    () =>
      saveUpload(
        "workspace",
        "personal",
        "forged.pdf",
        "application/pdf",
        Buffer.from("%PNG-not-a-pdf"),
      ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "invalid_pdf",
  );
  const saved = await saveUpload(
    "workspace",
    "personal",
    "ok.pdf",
    "application/pdf",
    Buffer.from("%PDF-1.4\n% test"),
  );
  assert.equal(saved.mime, "application/pdf");
  assert.equal(saved.projectId, "personal");
});

test("saveUpload rejects ghost projectId outside personal", async () => {
  await assert.rejects(
    () =>
      saveUpload(
        "workspace",
        "missing-club",
        "ok.pdf",
        "application/pdf",
        Buffer.from("%PDF-1.4\n% test"),
      ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "project_not_found",
  );
  put("project", "workspace", {
    id: "tku-zen",
    name: "禪學社",
    createdAt: new Date().toISOString(),
  });
  const saved = await saveUpload(
    "workspace",
    "tku-zen",
    "ok.pdf",
    "application/pdf",
    Buffer.from("%PDF-1.4\n% test"),
  );
  assert.equal(saved.projectId, "tku-zen");
});
