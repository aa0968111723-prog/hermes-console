import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-materials-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3261";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";

const { ApiError } = await import("../lib/server/security");
const { saveUpload } = await import("../lib/server/materials");

test("saveUpload rejects forged PDF and unknown projects", async () => {
  await assert.rejects(
    () =>
      saveUpload(
        "workspace",
        "personal",
        "script.pdf",
        "application/pdf",
        Buffer.from("<script>alert(1)</script>"),
      ),
    (error: unknown) => error instanceof ApiError && error.code === "invalid_pdf",
  );
  await assert.rejects(
    () =>
      saveUpload(
        "workspace",
        "personal",
        "mz.pdf",
        "application/pdf",
        Buffer.from("MZ\0\0\0\0\0\0"),
      ),
    (error: unknown) => error instanceof ApiError && error.code === "invalid_pdf",
  );
  await assert.rejects(
    () =>
      saveUpload(
        "workspace",
        "ghost_project_nonexistent_9999",
        "brief.pdf",
        "application/pdf",
        Buffer.from("%PDF-1.4\n%%EOF\n"),
      ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "project_not_found",
  );
  const ok = await saveUpload(
    "workspace",
    "personal",
    "brief.pdf",
    "application/pdf",
    Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
  );
  assert.equal(ok.mime, "application/pdf");
  assert.equal(ok.projectId, "personal");
});
