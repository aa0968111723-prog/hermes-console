import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Material } from "../lib/contracts";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-materials-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3261";

const { ApiError } = await import("../lib/server/security");
const {
  filePath,
  ingestDriveFact,
  listMaterials,
  saveReference,
  saveUpload,
} = await import("../lib/server/materials");
const { put, list } = await import("../lib/server/store");
const { ingestUrl } = await import("../lib/server/inspiration");
const materialsRoute = await import("../app/api/materials/route");
const workspace = await import("../app/api/workspace/route");

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

function originRequest(path: string, init?: RequestInit) {
  return new Request("http://localhost:3261" + path, {
    ...init,
    headers: {
      Origin: process.env.CONSOLE_ORIGIN!,
      ...(init?.headers || {}),
    },
  });
}

test("uploading the same PNG twice marks the second as duplicate and keeps both files", async () => {
  const png = await sharp({
    create: { width: 6, height: 4, channels: 3, background: "#356b45" },
  })
    .png()
    .toBuffer();
  const first = await saveUpload(
    "workspace",
    "personal",
    "poster.png",
    "image/png",
    png,
  );
  const second = await saveUpload(
    "workspace",
    "personal",
    "poster-copy.png",
    "image/png",
    png,
  );
  assert.equal(first.source?.type, "upload");
  assert.equal(first.source?.provider, "hermes_upload");
  assert.equal(first.format, "image/png");
  assert.equal(first.license, "user_provided");
  assert.equal(first.rights, "user_provided");
  assert.equal(first.dedupeStatus, "primary");
  assert.equal(first.duplicateOf, null);
  assert.ok(first.contentSha256);
  assert.equal(first.people, undefined);
  assert.equal(second.contentSha256, first.contentSha256);
  assert.equal(second.dedupeStatus, "duplicate");
  assert.equal(second.duplicateOf, first.id);
  assert.notEqual(second.id, first.id);
  await access(filePath("workspace", first.id), constants.F_OK);
  await access(filePath("workspace", second.id), constants.F_OK);
  const left = await readFile(filePath("workspace", first.id));
  const right = await readFile(filePath("workspace", second.id));
  assert.deepEqual(left, right);
  const visible = listMaterials("workspace");
  assert.equal(
    visible.some((item) => item.id === first.id),
    true,
  );
  assert.equal(
    visible.some((item) => item.id === second.id),
    false,
  );
  const all = listMaterials("workspace", { includeDuplicates: true });
  assert.equal(
    all.some((item) => item.id === second.id),
    true,
  );
  const listed = await materialsRoute.GET(originRequest("/api/materials"));
  assert.equal(listed.status, 200);
  const listedBody = (await listed.json()) as { materials: Material[] };
  assert.equal(
    listedBody.materials.some((item) => item.id === second.id),
    false,
  );
  const adminList = await materialsRoute.GET(
    originRequest("/api/materials?includeDuplicates=true"),
  );
  const adminBody = (await adminList.json()) as { materials: Material[] };
  assert.equal(
    adminBody.materials.some((item) => item.id === second.id),
    true,
  );
  const workspaceList = await workspace.GET(originRequest("/api/workspace"));
  assert.equal(workspaceList.status, 200);
  const workspaceBody = (await workspaceList.json()) as {
    materials: Material[];
  };
  assert.equal(
    workspaceBody.materials.some((item) => item.dedupeStatus === "duplicate"),
    false,
  );
  const workspaceAdmin = await workspace.GET(
    originRequest("/api/workspace?includeDuplicates=1"),
  );
  const workspaceAdminBody = (await workspaceAdmin.json()) as {
    materials: Material[];
  };
  assert.equal(
    workspaceAdminBody.materials.some((item) => item.id === second.id),
    true,
  );
});

test("reference POST writes web_https source, format, fingerprint and dual-writes license", async () => {
  const created = saveReference("workspace", {
    projectId: "personal",
    title: "外部海報",
    url: "https://WWW.Example.com/poster.png?utm_source=ig#frag",
    notes: "僅供構圖參考",
    tags: ["poster"],
  });
  assert.equal(created.kind, "reference");
  assert.equal(created.source?.type, "web_https");
  assert.equal(created.format, "url/https");
  assert.equal(created.rights, "reference_only");
  assert.equal(created.license, "reference_only");
  assert.equal(created.url, "https://example.com/poster.png");
  assert.equal(created.dedupeStatus, "primary");
  assert.equal(created.people, undefined);
  const viaRoute = await materialsRoute.POST(
    originRequest("/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "外部海報複本",
        url: "https://example.com/poster.png?utm_source=other",
      }),
    }),
  );
  assert.equal(viaRoute.status, 201);
  const payload = (await viaRoute.json()) as { material: Material };
  assert.equal(payload.material.duplicateOf, created.id);
  assert.equal(payload.material.dedupeStatus, "duplicate");
  assert.equal(payload.material.source?.type, "web_https");
  assert.equal(payload.material.license, "reference_only");
});

test("inspiration and Drive fact ingest write source types without member names", () => {
  const inspiration = ingestUrl({
    projectId: "personal",
    url: "https://www.instagram.com/p/creative-asset-fixture",
    account: "龜龜",
    caption: "社課海報構圖",
  });
  const inspirationMaterials = list<Material>("material", "workspace").filter(
    (item) => item.url === inspiration.sourceUrl,
  );
  assert.equal(inspirationMaterials.length, 1);
  assert.equal(inspirationMaterials[0].source?.type, "inspiration");
  assert.equal(inspirationMaterials[0].source?.provider, "instagram");
  assert.equal(inspirationMaterials[0].format, "url/https");
  assert.equal(inspirationMaterials[0].license, "reference_only");
  assert.equal(inspirationMaterials[0].people, undefined);
  const drive = ingestDriveFact({
    owner: "workspace",
    projectId: "personal",
    title: "社課知識列",
    locator:
      "https://docs.google.com/spreadsheets/d/1JVM0trGOeS49Sjjg3BoaKnS1Z0lT0hoWT5dCRsD97bs/edit?usp=sharing&row=KP-1",
    notes: "Drive 列事實",
  });
  assert.equal(drive.source?.type, "drive_fact");
  assert.equal(drive.source?.provider, "sheets");
  assert.equal(drive.source?.locator, "1JVM0trGOeS49Sjjg3BoaKnS1Z0lT0hoWT5dCRsD97bs");
  assert.equal(drive.format, "url/https");
  assert.equal(drive.people, undefined);
  const driveLink = ingestUrl({
    projectId: "personal",
    url: "https://drive.google.com/file/d/abcDriveFactFile01/view",
  });
  const driveMaterials = list<Material>("material", "workspace").filter(
    (item) => item.url === driveLink.sourceUrl,
  );
  assert.equal(driveMaterials[0].source?.type, "drive_fact");
  assert.equal(driveMaterials[0].source?.provider, "google_drive");
  assert.equal(driveMaterials[0].source?.locator, "abcDriveFactFile01");
  assert.equal(driveMaterials[0].people, undefined);
});
