import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-truth-qa-"));
process.env.CONSOLE_ORIGIN = "https://console.example";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";

const {
  auditEventCopy,
  classifySourceUrl,
  dateWeekdayConflicts,
  taipeiWeekday,
  weekdayLabel,
} = await import("../lib/server/qa");
const { composeTaskInstructions } = await import(
  "../lib/server/orchestrator/instructions"
);
const { interpretGoal } = await import("../lib/server/orchestrator/goal");
const { toolsList, callTool } = await import("../lib/server/mcp");
const creative = await import("../lib/server/creative");

function fact(
  field: "name" | "date" | "time" | "location" | "registration" | "fee" | "organizer",
  value: string,
  state: "pending" | "user_provided" | "confirmed" | "rejected" = "confirmed",
  sources: Array<{ url: string }> = [],
) {
  return {
    field,
    value,
    visibility: "public" as const,
    state,
    sources: sources.map((item) => ({
      url: item.url,
      queriedAt: "2026-09-09T00:00:00.000Z",
      note: "fixture",
    })),
  };
}

test("LOCAL_CONTRACT: Drive/TKU URLs rank above Instagram; IG cannot be VERIFIED", () => {
  assert.equal(
    classifySourceUrl("https://drive.google.com/drive/folders/1H-GuCfVw51D5_ipAoivjboabhb7iaKt6"),
    "drive",
  );
  assert.equal(classifySourceUrl("https://www.tku.edu.tw/"), "tku_official");
  assert.equal(classifySourceUrl("https://www.instagram.com/tku_zc/"), "instagram");
});

test("LOCAL_CONTRACT: owner confirmation without retrieve is LIKELY, never VERIFIED", () => {
  const audit = auditEventCopy({
    facts: [
      fact("name", "115學年度迎新茶會", "confirmed", [
        { url: "https://drive.google.com/file/d/abc" },
      ]),
      fact("date", "2026-09-10", "confirmed"),
      fact("location", "宮燈教室", "user_provided"),
    ],
    text: "淡江大學禪學社迎新茶會，2026-09-10（四）宮燈教室見。",
  });
  const name = audit.claims.find((item) => item.field === "name");
  const date = audit.claims.find((item) => item.field === "date");
  const location = audit.claims.find((item) => item.field === "location");
  const speaker = audit.claims.find((item) => item.field === "speaker");
  assert.equal(name?.status, "LIKELY");
  assert.equal(date?.status, "LIKELY");
  assert.equal(location?.status, "UNVERIFIED");
  assert.equal(speaker?.status, "UNVERIFIED");
  assert.equal(
    audit.claims.some((item) => item.status === "VERIFIED"),
    false,
  );
  assert.equal(audit.publishBlocked, true);
  assert.equal(audit.retrieved, false);
  assert.equal(audit.imageText, "UNVERIFIED");
});

test("LOCAL_CONTRACT: conflicting dates and weekday mismatch fail closed", () => {
  assert.equal(weekdayLabel(taipeiWeekday({ year: 2026, month: 9, day: 10 })), "週四");
  const conflicts = dateWeekdayConflicts("2026-09-10（三）", ["2026-09-10"]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.actual, "週四");
  assert.equal(conflicts[0]?.claimed, "週三");

  const audit = auditEventCopy({
    facts: [
      fact("date", "2026-09-10", "confirmed"),
      fact("date", "2026-09-17", "pending"),
    ],
    text: "禪學社茶會 2026-09-10（三）歡迎來坐。",
  });
  const date = audit.claims.find((item) => item.field === "date");
  assert.equal(date?.status, "CONFLICTING");
  assert.ok(audit.issues.some((item) => item.includes("日期與星期不符")));
});

test("LOCAL_CONTRACT: simplified club name, fabricated form URL, QR without registration", () => {
  const audit = auditEventCopy({
    facts: [fact("name", "迎新茶會", "confirmed")],
    text:
      "欢迎来禅学社。QR碼報到 https://docs.google.com/forms/d/e/FAKEFORM/viewform",
  });
  assert.ok(audit.issues.some((item) => item.includes("禅学社")));
  assert.ok(audit.issues.some((item) => item.includes("未確認連結")));
  assert.ok(audit.issues.some((item) => item.includes("QR")));
  assert.equal(audit.qr, "UNVERIFIED");
});

test("LOCAL_CONTRACT: Instagram source cannot upgrade an internal fact", () => {
  const audit = auditEventCopy({
    facts: [
      fact("date", "2026-09-10", "confirmed", [
        { url: "https://www.instagram.com/p/abc/" },
      ]),
    ],
    text: "2026-09-10 禪學社",
  });
  assert.equal(audit.claims.find((item) => item.field === "date")?.status, "LIKELY");
  assert.match(
    audit.claims.find((item) => item.field === "date")?.note || "",
    /Instagram/,
  );
});

test("LOCAL_CONTRACT: confirmed time missing from copy, and organizer without 禪學社", () => {
  const missingTime = auditEventCopy({
    facts: [
      fact("name", "迎新茶會", "confirmed"),
      fact("time", "19:00", "confirmed"),
      fact("organizer", "某單位", "confirmed"),
    ],
    text: "淡江大學禪學社迎新茶會，地點之後再講。",
  });
  assert.ok(missingTime.issues.some((item) => item.includes("時間") && item.includes("19:00")));
  assert.ok(missingTime.issues.some((item) => item.includes("主辦單位")));
});

test("LOCAL_CONTRACT: Drive excerpt can VERIFIED matching fields; 待確認 and weekday errors stay closed", () => {
  const drive = [
    "演講名稱：由數字探索自己-生命靈數開啟你的蛻變之路",
    "日期：2026/10/7(三)",
    "時間：19:00~21:30",
    "地點：待確認",
    "講師：盧玫竹老師",
    "9/10(五) 文宣&演講貼文-設計完成",
  ].join("\n");
  const audit = auditEventCopy({
    facts: [
      fact("name", "由數字探索自己-生命靈數開啟你的蛻變之路", "pending"),
      fact("date", "2026-10-07", "pending"),
      fact("time", "19:00~21:30", "pending"),
      fact("location", "待確認", "pending"),
    ],
    text: "禪學社期初演講\n講師：盧玫竹老師\n2026-10-07 19:00",
    retrievedSource: { kind: "drive", text: drive },
  });
  assert.equal(audit.claims.find((item) => item.field === "name")?.status, "VERIFIED");
  assert.equal(audit.claims.find((item) => item.field === "date")?.status, "VERIFIED");
  assert.equal(audit.claims.find((item) => item.field === "speaker")?.status, "VERIFIED");
  assert.equal(audit.claims.find((item) => item.field === "location")?.status, "UNVERIFIED");
  assert.ok(audit.issues.some((item) => item.includes("日期與星期不符") && item.includes("9/10")));

  const invented = auditEventCopy({
    facts: [fact("date", "2026-10-08", "confirmed")],
    text: "2026-10-08 生命靈數演講",
    retrievedSource: { kind: "drive", text: drive },
  });
  assert.notEqual(invented.claims.find((item) => item.field === "date")?.status, "VERIFIED");
});

test("LOCAL_CONTRACT: speaker in copy without a sourced fact stays UNVERIFIED", () => {
  const audit = auditEventCopy({
    facts: [fact("name", "期初演講", "confirmed")],
    text: "期初演講\n講師：王老師\n地點未定",
  });
  const speaker = audit.claims.find((item) => item.field === "speaker");
  assert.equal(speaker?.value, "王老師");
  assert.equal(speaker?.status, "UNVERIFIED");
});

test("LOCAL_CONTRACT: creative 禪學社 tasks load truth pack; generic lookup does not", () => {
  const creativeGoal = interpretGoal(
    "幫我做給淡江大學大一新生看的禪學社茶會文案",
  );
  const creative = composeTaskInstructions({
    mode: "creative",
    text: "幫我做給淡江大學大一新生看的禪學社茶會文案",
    goal: creativeGoal,
  });
  assert.ok(creative.packs.includes("truth"));
  assert.match(creative.instructions, /workspace_audit_copy/);
  assert.match(creative.instructions, /CONFLICTING/);

  const lookupGoal = interpretGoal("研究 2026 年校園永續發展議題與國際案例");
  const lookup = composeTaskInstructions({
    mode: "creative",
    text: "研究 2026 年校園永續發展議題與國際案例",
    goal: lookupGoal,
  });
  assert.equal(lookup.packs.includes("truth"), false);
  assert.equal(lookup.includeLumenManual, false);
});

test("LOCAL_CONTRACT: workspace_audit_copy is listed read-only and checkCopy stays honest", async () => {
  assert.ok(toolsList("workspace").some((item) => item.name === "workspace_audit_copy"));
  const listed = toolsList("workspace").find((item) => item.name === "workspace_audit_copy");
  assert.equal(listed?.annotations.readOnlyHint, true);

  const empty = await callTool("workspace", "workspace_audit_copy", {}, "audit-empty");
  assert.equal(empty.isError, true);

  const lint = await callTool(
    "workspace",
    "workspace_audit_copy",
    { text: "禅学社 2026-09-10（三）" },
    "audit-text",
  );
  assert.equal(lint.isError, false);
  const body = (
    lint as { structuredContent: { result: { issues: string[]; publishBlocked: boolean } } }
  ).structuredContent.result;
  assert.equal(body.publishBlocked, true);
  assert.ok(body.issues.some((item) => item.includes("禅学社") || item.includes("星期")));

  const activity = creative.saveActivity(
    "workspace",
    {
      projectId: "personal",
      expectedRevision: 0,
      operationId: randomUUID(),
      title: "測試茶會",
      facts: [
        {
          field: "name",
          value: "測試茶會",
          visibility: "public",
          sources: [],
        },
        {
          field: "date",
          value: "2026-10-01",
          visibility: "public",
          sources: [],
        },
        {
          field: "location",
          value: "測試場地",
          visibility: "public",
          sources: [],
        },
      ],
    },
    "owner",
  );
  const confirmed = creative.confirmFacts(
    "workspace",
    activity.id,
    activity.revision,
    activity.facts.map((item) => item.id),
  );
  const copy = creative.saveCopy(
    "workspace",
    {
      projectId: "personal",
      activityId: confirmed.id,
      expectedRevision: 0,
      operationId: randomUUID(),
      title: "測試文案",
      format: "post",
      tone: "",
      audience: "",
      pages: [
        {
          title: "一",
          body: "測試茶會 2026-10-01 測試場地",
          visual: "",
        },
      ],
      materialIds: [],
      factIds: confirmed.facts.filter((item) => item.state === "confirmed").map((item) => item.id),
    },
    "owner",
  );
  const check = creative.checkCopy("workspace", copy);
  assert.equal(check.automaticVerificationComplete, false);
  assert.equal(check.publishBlocked, true);
  assert.equal(check.imageText, "UNVERIFIED");
  assert.ok(check.claims.length >= 8);
  assert.equal(
    check.claims.some((item) => item.status === "VERIFIED"),
    false,
  );
});
