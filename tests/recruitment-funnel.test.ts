import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-funnel-ro-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3261";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";

const { buildRecruitmentFunnelRead } = await import(
  "../lib/server/recruitment/funnel"
);
const { SHEETS } = await import("../lib/server/inspiration/sheets-sync");
const { mockStoreThrowForTests } = await import("../lib/server/store");
const funnelApi = await import("../app/api/recruitment/funnel/route");

const STAGE_IDS = ["forms", "sheets", "roster", "funnel", "attendance"] as const;

function request(path = "recruitment/funnel", origin = true) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (origin) headers.Origin = process.env.CONSOLE_ORIGIN!;
  return new Request("http://localhost:3261/api/" + path, {
    method: "GET",
    headers,
  });
}

function assertNoPii(body: unknown) {
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /學號/);
  assert.doesNotMatch(text, /電話/);
  assert.doesNotMatch(text, /姓名/);
  assert.doesNotMatch(text, /@gmail\.com/i);
  assert.equal("headcount" in (body as object), false);
  assert.equal("peopleCount" in (body as object), false);
  assert.equal("rosterRows" in ((body as { stages?: unknown }).stages as object || {}), false);
}

test("buildRecruitmentFunnelRead shape matches contract with tip catalog", () => {
  const read = buildRecruitmentFunnelRead({
    now: () => new Date("2026-09-10T00:00:00.000Z"),
  });
  assert.equal(read.contractVersion, 1);
  assert.equal(read.asOf, "2026-09-10T00:00:00.000Z");
  assert.deepEqual(
    read.stages.map((stage) => stage.id),
    [...STAGE_IDS],
  );
  assert.equal(read.redaction.rosterRows, "omitted");
  assert.equal(read.redaction.formReplies, "omitted");
  assert.equal(read.redaction.attendanceRows, "omitted");
  assert.equal(read.inspirationSheets?.registryCount, SHEETS.length);
  assert.equal(read.inspirationSheets?.registryCount, 6);

  const byId = Object.fromEntries(read.stages.map((stage) => [stage.id, stage]));
  assert.equal(byId.forms.status, "wired_ok");
  assert.equal(byId.forms.lane, "FACT");
  assert.ok(byId.forms.pathKeys?.includes("file-115-form"));
  assert.ok(byId.forms.pathKeys?.includes("form:115-1-events"));

  assert.equal(byId.sheets.status, "wired_ok");
  assert.equal(byId.sheets.lane, "INSPIRATION");
  assert.ok(byId.sheets.pathKeys?.includes("tamkang"));

  assert.equal(byId.roster.status, "wired_redacted");
  assert.equal(byId.roster.lane, "redacted");
  assert.ok(byId.roster.pathKeys?.includes("file-1141-roster"));
  assert.ok(["wired_redacted", "missing"].includes(byId.roster.status));

  assert.equal(byId.funnel.status, "missing");
  assert.equal(byId.funnel.lane, "none");

  assert.equal(byId.attendance.status, "missing");
  assert.ok(["wired_redacted", "missing"].includes(byId.attendance.status));

  assertNoPii(read);
});

test("inspirationSheets never promotes to roster FACT and has no fake headcounts", () => {
  const read = buildRecruitmentFunnelRead({
    sheetsSyncStatus: () => ({
      id: "latest",
      startedAt: "2026-09-10T00:00:00.000Z",
      finishedAt: "2026-09-10T00:01:00.000Z",
      read: 532,
      created: 0,
      skipped: 532,
      failed: 0,
      errors: [],
    }),
  });
  const roster = read.stages.find((stage) => stage.id === "roster");
  const sheets = read.stages.find((stage) => stage.id === "sheets");
  assert.equal(sheets?.lane, "INSPIRATION");
  assert.notEqual(roster?.lane, "FACT");
  assert.notEqual(roster?.lane, "INSPIRATION");
  assert.equal(read.inspirationSheets?.lastSync?.read, 532);
  // Sync counters are allowed; people headcounts are not.
  assert.equal(
    Object.prototype.hasOwnProperty.call(read, "registeredCount"),
    false,
  );
  assert.equal(Object.prototype.hasOwnProperty.call(roster || {}, "count"), false);
  assertNoPii(read);
});

test("catalog/store soft-fail yields 200-compatible degraded read (no throw)", () => {
  const read = buildRecruitmentFunnelRead({
    loadCatalog: () => {
      throw new Error("catalog boom");
    },
    loadGraph: () => {
      throw new Error("graph boom");
    },
    sheetsSyncStatus: () => {
      throw new Error("store boom");
    },
  });
  assert.equal(read.degraded, true);
  assert.equal(read.contractVersion, 1);
  assert.deepEqual(
    read.stages.map((stage) => stage.id),
    [...STAGE_IDS],
  );
  const byId = Object.fromEntries(read.stages.map((stage) => [stage.id, stage]));
  assert.equal(byId.forms.status, "degraded");
  assert.equal(byId.sheets.status, "degraded");
  assert.equal(byId.sheets.lane, "INSPIRATION");
  assert.ok(["wired_redacted", "missing"].includes(byId.roster.status));
  assert.equal(byId.funnel.status, "missing");
  assert.ok(["wired_redacted", "missing"].includes(byId.attendance.status));
  assert.equal(read.redaction.rosterRows, "omitted");
  assertNoPii(read);
});

test("GET /api/recruitment/funnel returns contract and soft-fails store wobble", async (t) => {
  const ok = await funnelApi.GET(request());
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.contractVersion, 1);
  assert.equal(body.redaction.rosterRows, "omitted");
  assert.equal(body.stages.length, 5);
  assertNoPii(body);

  t.after(() => mockStoreThrowForTests(null));
  mockStoreThrowForTests({
    get(kind) {
      if (kind === "sheet_sync") throw new Error("pg sheet_sync unavailable");
    },
  });
  const degraded = await funnelApi.GET(request());
  assert.equal(degraded.status, 200);
  const degradedBody = await degraded.json();
  assert.equal(degradedBody.degraded, true);
  const sheets = degradedBody.stages.find(
    (stage: { id: string }) => stage.id === "sheets",
  );
  assert.equal(sheets.status, "degraded");
  assert.equal(sheets.lane, "INSPIRATION");
  assertNoPii(degradedBody);
});

test("GET /api/recruitment/funnel auth aligns with knowledge GET (gateway gate)", async () => {
  const knowledgeApi = await import("../app/api/knowledge/route");
  const previous = process.env.CONSOLE_GATEWAY_SECRET;
  const previousAllow = process.env.CONSOLE_ALLOW_LOCAL_ACCESS;
  process.env.CONSOLE_GATEWAY_SECRET = "x".repeat(32);
  process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "false";
  try {
    const funnel = await funnelApi.GET(request());
    const knowledge = await knowledgeApi.GET(request("knowledge"));
    assert.equal(funnel.status, knowledge.status);
    assert.equal(funnel.status, 401);
    const body = await funnel.json();
    assert.equal(body.error?.code, "gateway_required");
  } finally {
    process.env.CONSOLE_GATEWAY_SECRET = previous;
    process.env.CONSOLE_ALLOW_LOCAL_ACCESS = previousAllow;
  }
});
