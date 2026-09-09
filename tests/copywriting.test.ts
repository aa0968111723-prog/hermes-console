import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { seedSession } from "./session-fixture";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-copywriting-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3231";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";

const {
  lintCopy,
  reviewCopy,
  FRESHMAN_TWINS,
  COPY_CHANNELS,
  scaffoldVariants,
} = await import("../lib/server/copywriting");
const { classifyIntent } = await import(
  "../lib/server/orchestrator/intent"
);
const { interpretGoal } = await import("../lib/server/orchestrator/goal");
const { composeTaskInstructions } = await import(
  "../lib/server/orchestrator/instructions"
);
const { buildPlan } = await import("../lib/server/orchestrator/planner");
const { callTool, toolsList } = await import("../lib/server/mcp");
const copyRoute = await import("../app/api/copywriting/route");
const { put } = await import("../lib/server/store");

const TEA_COPY = `🍵禪學社期初茶會【改變自己從靜定開始】🧘
改變，到底要怎麼做呢？花了數天、數月，甚至是數年累積出來的習慣，有的讓你安穩地度過人生中的關卡，卻在最需要的時候成為你成長路上的絆腳石。
禪學社期初茶會【改變自己從靜定開始】，邀請你一起從內心的沉澱開始，讓改變的動力與智慧如漣漪擴散💧
日期：2026/9/30（三）
時間：19:00~21:30（18:50 開放報到）
地點：OOOOOO
報名表單：https://forms.gle/Xs4PXyWKQW5ob29z6`;

const FRESHMAN_COPY = `剛搬來淡水，晚上還在想社團要不要加？
週三茶會來坐一下就好，沒有考試也沒有壓力，路過也可以認識朋友。
時間 9/30 19:00–21:30，地點確認後再告訴你。
想去就填表。`;

function request(body: unknown) {
  return new Request("http://localhost:3231/api/copywriting", {
    method: "POST",
    headers: {
      Cookie: seedSession().cookie,
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
    body: JSON.stringify(body),
  });
}

test("copy lint blocks spiritual filler and fake locations", () => {
  const banned = lintCopy({
    text: "用宇宙能量療癒覺醒靈性",
    channel: "ig_caption",
  });
  assert.ok(banned.some((item) => item.kind === "banned" && item.severity === "block"));
  const jargon = lintCopy({
    text: "改變自己，從靜定開始",
    channel: "poster_title",
  });
  assert.ok(jargon.some((item) => item.term === "靜定" && item.kind === "jargon"));
  assert.equal(
    jargon.some((item) => item.term === "靜定" && item.severity === "block"),
    false,
  );
  const placeholder = lintCopy({
    text: "地點：OOOOOO",
    channel: "event_intro",
  });
  assert.ok(placeholder.some((item) => item.kind === "placeholder"));
});

test("Drive 期初茶會文案：地點 UNKNOWN、缺 A/B/C、不發佈", () => {
  const review = reviewCopy({
    channel: "ig_caption",
    copy: TEA_COPY,
    facts: {
      name: "改變自己從靜定開始",
      date: "2026/9/30",
      time: "19:00~21:30",
      location: "待定",
      formUrl: "https://forms.gle/Xs4PXyWKQW5ob29z6",
    },
  });
  assert.equal(review.simulation, true);
  assert.equal(review.method, "rule_contract");
  assert.equal(review.publish, false);
  assert.equal(review.facts.location.kind, "UNKNOWN");
  assert.equal(review.facts.date.kind, "FACT");
  assert.ok(review.variants.missing.includes("B｜最有梗"));
  assert.ok(review.variants.missing.includes("C｜最溫暖"));
  assert.equal(review.suggestions?.method, "rule_scaffold");
  assert.equal(review.suggestions?.publish, false);
  assert.ok(review.lint.some((item) => item.term === "靜定"));
  assert.ok(review.lint.some((item) => item.term === "漣漪擴散"));
  assert.equal(review.personas.length, 10);
  assert.equal(FRESHMAN_TWINS.length, 10);
  assert.equal(review.personas.find((item) => item.id === "dorm")?.wouldStop, false);
  assert.equal(
    review.personas.find((item) => item.id === "commute")?.wouldStop,
    false,
  );
  assert.ok(review.personas.every((item) => item.wouldFillForm === false));
  assert.equal(Object.prototype.hasOwnProperty.call(review, "conversionRate"), false);
});

test("freshman-friendly copy stops more twins and keeps unknown location", () => {
  const review = reviewCopy({
    channel: "ig_caption",
    variants: {
      a: FRESHMAN_COPY,
      b: "社博逛到腳痠？週三晚上來坐一下，手搖喝完再決定要不要加。",
      c: "剛來淡大還沒認識人的話，茶會來坐就好，我們不會點名。",
    },
    facts: { location: "待確認", date: "2026/9/30", time: "19:00" },
  });
  assert.deepEqual(review.variants.missing, []);
  assert.equal(review.facts.location.kind, "UNKNOWN");
  assert.ok(review.structure.hook);
  assert.ok(review.structure.relatable);
  assert.ok(review.structure.cta);
  assert.ok(review.personas.filter((item) => item.wouldStop).length >= 4);
  assert.ok(review.next.some((item) => /UNKNOWN/.test(item)));
});

test("caption intent uses copywriting pack; Hermes review tool is listed", async () => {
  assert.equal(classifyIntent("幫我寫 IG caption"), "create");
  const goal = interpretGoal("幫我寫招生文案 caption，從新生角度反向看");
  const composed = composeTaskInstructions({
    mode: "creative",
    text: "幫我寫招生文案 caption，從新生角度反向看",
    goal,
  });
  assert.ok(composed.packs.includes("copywriting"));
  assert.match(composed.instructions, /workspace_review_copy/);
  assert.match(composed.instructions, /最自然/);
  const plan = buildPlan(goal, [], "balanced");
  assert.ok(plan.steps.some((step) => step.title === "文案審核"));
  assert.ok(
    toolsList("workspace").some((tool) => tool.name === "workspace_review_copy"),
  );
  const listed = toolsList("workspace").find(
    (tool) => tool.name === "workspace_review_copy",
  );
  assert.equal(listed?.annotations.readOnlyHint, true);
});

test("API and MCP review are rule_contract and never publish", async () => {
  const api = await copyRoute.POST(
    request({
      copy: TEA_COPY,
      channel: "ig_caption",
      facts: { location: "待定", date: "2026/9/30" },
    }),
  );
  assert.equal(api.status, 200);
  const json = await api.json();
  assert.equal(json.publish, false);
  assert.equal(json.method, "rule_contract");
  assert.equal(json.facts.location.kind, "UNKNOWN");

  const conversationId = randomUUID();
  const taskId = randomUUID();
  put("conversation", "workspace", {
    id: conversationId,
    projectId: "personal",
    messages: [],
  });
  put("task", "workspace", {
    id: taskId,
    conversationId,
    state: "running",
    events: [],
    attachments: [],
  });
  const tool = await callTool(
    "workspace",
    "workspace_review_copy",
    {
      copy: FRESHMAN_COPY,
      variants: { a: FRESHMAN_COPY, b: "來坐一下", c: "一起認識人就好" },
      facts: { location: "待定" },
      taskId,
    },
    "review-1",
  );
  assert.equal(tool.isError, false);
  const result = (
    tool as { structuredContent: { result: { publish: boolean; channel: string } } }
  ).structuredContent.result;
  assert.equal(result.publish, false);
  assert.equal(result.channel, "ig_caption");
  assert.ok(COPY_CHANNELS.includes("google_form"));
});

test("Drive 社博草稿用文館左側；茶會地點保持 UNKNOWN", () => {
  const fair = scaffoldVariants({
    kind: "fair",
    channel: "story",
    facts: {
      date: "9/10、9/11、9/14–17",
      location: "文館左側",
    },
  });
  assert.equal(fair.method, "rule_scaffold");
  assert.equal(fair.publish, false);
  assert.equal(fair.facts.location.kind, "FACT");
  assert.match(fair.variants.a, /文館左側|來坐一下/);
  const fairReview = reviewCopy({
    channel: "story",
    variants: fair.variants,
    facts: { date: "9/10", location: "文館左側" },
  });
  assert.deepEqual(fairReview.variants.missing, []);
  assert.ok(fairReview.personas.filter((item) => item.wouldStop).length >= 4);

  const tea = scaffoldVariants({
    kind: "tea",
    facts: {
      name: "改變自己從靜定開始",
      date: "2026/9/30",
      time: "19:00~21:30",
      location: "待定",
    },
  });
  assert.equal(tea.facts.location.kind, "UNKNOWN");
  assert.equal(/SG109|教室/.test(JSON.stringify(tea.variants)), false);
  const teaReview = reviewCopy({
    channel: "ig_caption",
    variants: tea.variants,
    facts: { date: "2026/9/30", time: "19:00", location: "待定" },
  });
  assert.ok(teaReview.structure.hook);
  assert.ok(!teaReview.lint.some((item) => item.kind === "religious"));
});
