import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FunnelLane, Material, MaterialSource } from "../lib/contracts";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-lane-labels-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3261";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";

const { laneForMaterial, laneForInspiration } = await import(
  "../lib/server/lanes"
);
const { saveReference, sourceForRemoteUrl } = await import(
  "../lib/server/materials"
);
const materialsRoute = await import("../app/api/materials/route");
const { buildRecruitmentFunnelRead } = await import(
  "../lib/server/recruitment/funnel"
);

function materialWith(
  source: MaterialSource | undefined,
): Pick<Material, "source"> {
  return source === undefined ? {} : { source };
}

test("laneForMaterial table: drive_fact FACT; inspiration INSPIRATION; web/unlabeled none", () => {
  const cases: Array<{
    source?: MaterialSource;
    lane: FunnelLane;
    label: string;
  }> = [
    {
      label: "drive_fact",
      source: { type: "drive_fact", locator: "file-fixture-id", provider: "google_drive" },
      lane: "FACT",
    },
    {
      label: "inspiration",
      source: { type: "inspiration", locator: "https://example.com/x", provider: "instagram" },
      lane: "INSPIRATION",
    },
    {
      label: "web_https",
      source: { type: "web_https", locator: "https://example.com/poster.png" },
      lane: "none",
    },
    { label: "upload", source: { type: "upload", provider: "hermes_upload" }, lane: "none" },
    { label: "line_export", source: { type: "line_export" }, lane: "none" },
    { label: "unknown", source: { type: "unknown" }, lane: "none" },
    { label: "missing source", source: undefined, lane: "none" },
  ];
  for (const row of cases) {
    assert.equal(
      laneForMaterial(materialWith(row.source)),
      row.lane,
      row.label,
    );
  }
  // Old unlabeled must never silent-upgrade to FACT (even if caller imagines a Drive URL).
  assert.equal(laneForMaterial({}), "none");
  assert.equal(laneForMaterial(null), "none");
  assert.equal(laneForMaterial(undefined), "none");
  assert.notEqual(laneForMaterial({ source: { type: "web_https" } }), "FACT");
});

test("laneForInspiration: public_index and all sourceTypes are INSPIRATION; never FACT/roster", () => {
  const sourceTypes = [
    "public_index",
    "user_url",
    "web_search",
    "authorized_api",
    undefined,
  ] as const;
  for (const sourceType of sourceTypes) {
    assert.equal(
      laneForInspiration(sourceType === undefined ? {} : { sourceType }),
      "INSPIRATION",
      String(sourceType),
    );
  }
  assert.equal(laneForInspiration(null), "INSPIRATION");
  assert.equal(laneForInspiration(undefined), "INSPIRATION");
  // Hard ban: public_index must never be treated as roster/FACT/drive_fact truth.
  assert.notEqual(laneForInspiration({ sourceType: "public_index" }), "FACT");
  assert.notEqual(
    laneForInspiration({ sourceType: "public_index" }),
    "redacted",
  );
  assert.notEqual(laneForInspiration({ sourceType: "public_index" }), "none");
});

test("sourceForRemoteUrl + saveReference: Drive/Sheets -> drive_fact; inspiration host -> inspiration; else web_https", () => {
  const drive = sourceForRemoteUrl(
    "https://docs.google.com/spreadsheets/d/fixtureSheetId01ABC/edit",
  );
  assert.equal(drive.type, "drive_fact");
  assert.equal(drive.provider, "sheets");
  assert.equal(drive.locator, "fixtureSheetId01ABC");

  const file = sourceForRemoteUrl(
    "https://drive.google.com/file/d/fixtureDriveFile01/view",
  );
  assert.equal(file.type, "drive_fact");
  assert.equal(file.provider, "google_drive");

  const ig = sourceForRemoteUrl(
    "https://www.instagram.com/p/fixture-creative-post/",
  );
  assert.equal(ig.type, "inspiration");
  assert.equal(ig.provider, "instagram");

  const plain = sourceForRemoteUrl("https://example.com/poster.png");
  assert.equal(plain.type, "web_https");

  const saved = saveReference("workspace", {
    projectId: "personal",
    title: "Drive sheet ref",
    url: "https://docs.google.com/spreadsheets/d/fixtureSheetId01ABC/edit?usp=sharing",
    notes: "structure link only",
    tags: ["fixture"],
  });
  assert.equal(saved.source?.type, "drive_fact");
  assert.equal(saved.source?.provider, "sheets");
  assert.equal(saved.source?.locator, "fixtureSheetId01ABC");
  assert.equal(laneForMaterial(saved), "FACT");
  // No fake headcounts / roster fields on the material.
  assert.equal("headcount" in saved, false);
  assert.equal("peopleCount" in saved, false);
  assert.equal(saved.people, undefined);
});

test("materials POST reference path: Drive URL becomes drive_fact (not hard-coded web_https)", async () => {
  const res = await materialsRoute.POST(
    new Request("http://localhost:3261/api/materials", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3261",
      },
      body: JSON.stringify({
        title: "Sheets structure",
        url: "https://docs.google.com/spreadsheets/d/fixturePostSheet99/edit",
        notes: "no roster",
      }),
    }),
  );
  assert.equal(res.status, 201);
  const body = (await res.json()) as { material: Material };
  assert.equal(body.material.source?.type, "drive_fact");
  assert.equal(body.material.source?.provider, "sheets");
  assert.equal(laneForMaterial(body.material), "FACT");
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /headcount/i);
  assert.doesNotMatch(text, /rosterRows/);
  assert.doesNotMatch(text, /學號/);
});

test("unlabeled material read derives none; never upgrades to FACT", () => {
  const unlabeled: Pick<Material, "source"> = {};
  assert.equal(laneForMaterial(unlabeled), "none");
  const smokeWeb: Pick<Material, "source"> = {
    source: { type: "web_https", locator: "https://docs.google.com/spreadsheets/d/looksLikeDrive/edit" },
  };
  // Read-time: existing web_https stays none even if URL shape looks like Drive
  // (upgrade requires explicit ingestDriveFact / reclassify — not silent).
  assert.equal(laneForMaterial(smokeWeb), "none");
});

test("funnel regression: sheets lane remains INSPIRATION; no headcount fields", () => {
  const read = buildRecruitmentFunnelRead({
    now: () => new Date("2026-09-10T00:00:00.000Z"),
  });
  const sheets = read.stages.find((s) => s.id === "sheets");
  assert.ok(sheets);
  assert.equal(sheets!.lane, "INSPIRATION");
  assert.equal(read.redaction.rosterRows, "omitted");
  assert.equal(read.redaction.formReplies, "omitted");
  assert.equal(read.redaction.attendanceRows, "omitted");
  const text = JSON.stringify(read);
  assert.doesNotMatch(text, /"headcount"/);
  assert.doesNotMatch(text, /"peopleCount"/);
  assert.equal("headcount" in read, false);
});