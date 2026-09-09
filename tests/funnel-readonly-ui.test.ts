import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FUNNEL_FOLD_SUMMARY,
  FUNNEL_STAGE_IDS,
  FUNNEL_UNAVAILABLE_COPY,
  skeletonStages,
  toFunnelUiState,
} from "../lib/client/recruitment-funnel";

/**
 * LOCAL_CONTRACT — P0′ funnel readonly UI (Help card + Inspiration fold).
 * Does not execute React. No funnel API / lane / redaction changes.
 */

test("funnel UI helpers: five stages, unavailable copy, no fake wired_ok on empty", () => {
  assert.deepEqual([...FUNNEL_STAGE_IDS], [
    "forms",
    "sheets",
    "roster",
    "funnel",
    "attendance",
  ]);
  assert.equal(FUNNEL_UNAVAILABLE_COPY, "狀態暫不可用");
  assert.equal(FUNNEL_FOLD_SUMMARY, "漏斗五階");

  const empty = toFunnelUiState(null);
  assert.equal(empty.kind, "unavailable");
  assert.ok(empty.kind === "unavailable");
  assert.equal(empty.stages.length, 5);
  assert.ok(empty.stages.every((s) => s.status === "unknown"));
  assert.ok(empty.stages.every((s) => s.status !== "wired_ok"));

  const degraded = toFunnelUiState({
    contractVersion: 1,
    asOf: "2026-09-10T00:00:00.000Z",
    degraded: true,
    stages: [
      { id: "forms", status: "degraded", lane: "none", notes: "catalog_unavailable" },
      { id: "sheets", status: "wired_ok", lane: "INSPIRATION", notes: "sheets_sync_inspiration_lane" },
      { id: "roster", status: "missing", lane: "none" },
      { id: "funnel", status: "missing", lane: "none" },
      { id: "attendance", status: "missing", lane: "none" },
    ],
    redaction: {
      rosterRows: "omitted",
      formReplies: "omitted",
      attendanceRows: "omitted",
    },
  });
  assert.equal(degraded.kind, "unavailable");
  assert.ok(degraded.kind === "unavailable");
  const sheets = degraded.stages.find((s) => s.id === "sheets");
  assert.equal(sheets?.lane, "INSPIRATION");
  assert.equal(sheets?.status, "wired_ok");
  // UI model must not invent pathKeys / headcounts
  assert.equal(
    Object.prototype.hasOwnProperty.call(sheets || {}, "pathKeys"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(sheets || {}, "count"),
    false,
  );

  const ready = toFunnelUiState({
    contractVersion: 1,
    asOf: "2026-09-10T00:00:00.000Z",
    stages: FUNNEL_STAGE_IDS.map((id) => ({
      id,
      status: id === "sheets" ? "wired_ok" : id === "forms" ? "wired_ok" : "missing",
      lane: id === "sheets" ? "INSPIRATION" : id === "forms" ? "FACT" : "none",
      notes: id === "sheets" ? "sheets_sync_inspiration_lane" : undefined,
    })),
    redaction: {
      rosterRows: "omitted",
      formReplies: "omitted",
      attendanceRows: "omitted",
    },
  });
  assert.equal(ready.kind, "ready");
  assert.ok(ready.kind === "ready");
  assert.equal(ready.stages.find((s) => s.id === "sheets")?.lane, "INSPIRATION");
  assert.notEqual(ready.stages.find((s) => s.id === "sheets")?.lane, "FACT");

  const sk = skeletonStages();
  assert.ok(sk.every((s) => s.status === "unknown"));
  assert.doesNotMatch(JSON.stringify(sk), /wired_ok/);
});

test("funnel readonly UI wired to Help + Inspiration fold; no headcount/PII render", async () => {
  const card = await readFile(
    new URL("../components/help/RecruitmentFunnelCard.tsx", import.meta.url),
    "utf8",
  );
  const help = await readFile(
    new URL("../components/help/HelpPage.tsx", import.meta.url),
    "utf8",
  );
  const board = await readFile(
    new URL("../components/inspiration/InspirationBoard.tsx", import.meta.url),
    "utf8",
  );
  const client = await readFile(
    new URL("../lib/client/recruitment-funnel.ts", import.meta.url),
    "utf8",
  );
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(help, /RecruitmentFunnelCard/);
  assert.match(help, /招生真相/);
  assert.match(board, /RecruitmentFunnelFold/);
  assert.match(board, /RecruitmentTruthNotice/);
  // Fold sits below soft notice — not a permanent main-column card body
  assert.match(card, /FUNNEL_FOLD_SUMMARY|漏斗五階/);
  assert.match(card, /funnel-readonly-fold/);
  assert.match(card, /FUNNEL_UNAVAILABLE_COPY|狀態暫不可用/);
  assert.match(card, /fetchRecruitmentFunnel/);
  assert.doesNotMatch(card, /headcount|peopleCount|rosterRows|formReplies/);
  assert.doesNotMatch(client, /\bpeopleCount\b/);
  assert.doesNotMatch(client, /registeredCount|rosterRows|formReplies/);
  assert.match(client, /INSPIRATION/);
  assert.match(client, /狀態暫不可用/);

  assert.ok(css.includes(".funnel-readonly-card"));
  assert.ok(css.includes(".funnel-readonly-fold"));
  assert.ok(css.includes("max-width: 430px"));
  assert.match(css, /\.funnel-readonly-fold-summary\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(css, /\.funnel-readonly-fold-summary\s*\{[\s\S]*?min-width:\s*44px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);

  // sheets lane must not be described as roster/names in UI copy
  assert.match(card, /不是名單/);
  assert.doesNotMatch(card, /sheets.*名單真相|靈感表.*就是名單/);
});
