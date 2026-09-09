import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSession } from "./session-fixture";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-visual-concepts-"),
);
process.env.CONSOLE_ORIGIN = "https://console.example";
seedSession();

const { put } = await import("../lib/server/store");
const { saveActivity, confirmFacts, visualConceptsFor } =
  await import("../lib/server/creative");
const { compileVisualConcepts } =
  await import("../lib/server/creative/visual-concepts");
const { VISUAL_FORMATS, copyFormatToVisual, listVisualFormats } =
  await import("../lib/server/creative/formats");
const { directionToSpec } = await import("../lib/server/creative/spec");
const { callTool, toolsList } = await import("../lib/server/mcp");
const { permissionClass } = await import("../lib/server/permissions");
const { interpretGoal } = await import("../lib/server/orchestrator/goal");
const { routeTools } = await import("../lib/server/orchestrator/tool-router");
const { buildPlan } = await import("../lib/server/orchestrator/planner");
const { emptyIntegration } = await import("../lib/server/certification/registry");
const { activityKind, toolDisplayLabel } =
  await import("../lib/client/activity");

const fact = (
  field: "name" | "date" | "time" | "location" | "registration" | "contact",
  value: string,
  visibility: "public" | "private" = "public",
) => ({ field, value, visibility, sources: [] });

function taskContext(projectId = "personal") {
  const conversationId = randomUUID();
  const taskId = randomUUID();
  put("conversation", "workspace", { id: conversationId, projectId, messages: [] });
  put("task", "workspace", {
    id: taskId,
    conversationId,
    state: "running",
    events: [],
    attachments: [],
  });
  return taskId;
}

test("canonical visual formats use IG 4:5, 9:16 and print A4/A3 pixels", () => {
  assert.equal(VISUAL_FORMATS.ig_feed_4x5.width, 1080);
  assert.equal(VISUAL_FORMATS.ig_feed_4x5.height, 1350);
  assert.equal(VISUAL_FORMATS.ig_story.width, 1080);
  assert.equal(VISUAL_FORMATS.ig_story.height, 1920);
  assert.equal(VISUAL_FORMATS.ig_reels_cover.width, 1080);
  assert.equal(VISUAL_FORMATS.ig_reels_cover.height, 1920);
  assert.equal(VISUAL_FORMATS.ig_carousel_4x5.width, 1080);
  assert.equal(VISUAL_FORMATS.ig_carousel_4x5.height, 1350);
  assert.equal(VISUAL_FORMATS.poster_a4.width, 2480);
  assert.equal(VISUAL_FORMATS.poster_a4.height, 3508);
  assert.equal(VISUAL_FORMATS.poster_a4.dpi, 300);
  assert.equal(VISUAL_FORMATS.poster_a3.width, 3508);
  assert.equal(VISUAL_FORMATS.poster_a3.height, 4961);
  assert.equal(copyFormatToVisual("post").id, "ig_feed_4x5");
  assert.equal(copyFormatToVisual("reel").id, "ig_reels_cover");
  assert.equal(listVisualFormats().length, 6);
  const reels = VISUAL_FORMATS.ig_reels_cover.cropSafe;
  assert.ok(reels);
  assert.equal(reels.y, 285);
  assert.equal(reels.height, 1350);
});

test("placeholder locations like 待確認 stay off the poster", () => {
  const saved = saveActivity(
    "workspace",
    {
      projectId: "personal",
      expectedRevision: 0,
      operationId: randomUUID(),
      title: "TEST ONLY 期初演講",
      facts: [
        fact("name", "由數字探索自己-生命靈數開啟你的蛻變之路"),
        fact("date", "2026/10/7"),
        fact("time", "19:00~21:30"),
        fact("location", "待確認"),
      ],
    },
    "owner",
  );
  const pack = compileVisualConcepts(saved, "ig_feed_4x5");
  assert.equal(pack.overlayText.name, "由數字探索自己-生命靈數開啟你的蛻變之路");
  assert.equal(pack.overlayText.date, "2026/10/7");
  assert.equal(pack.overlayText.time, "19:00~21:30");
  assert.equal(pack.overlayText.location, null);
  assert.ok(pack.unknownFields.includes("地點"));
  assert.equal(pack.concepts[0].qrPlacement.include, false);
  assert.equal(JSON.stringify(pack.concepts).includes("待確認"), false);
});

test("incomplete activity facts stay UNKNOWN and are not invented", () => {
  const saved = saveActivity(
    "workspace",
    {
      projectId: "personal",
      expectedRevision: 0,
      operationId: randomUUID(),
      title: "TEST ONLY 茶會",
      facts: [
        fact("name", "迎新茶會"),
        fact("contact", "私密電話", "private"),
      ],
    },
    "owner",
  );
  const pack = compileVisualConcepts(saved, "ig_feed_4x5");
  assert.equal(pack.concepts.length, 3);
  assert.deepEqual(
    pack.concepts.map((item) => item.id),
    ["A", "B", "C"],
  );
  assert.equal(pack.overlayText.date, null);
  assert.equal(pack.overlayText.location, null);
  assert.equal(pack.overlayText.registration, null);
  assert.ok(pack.unknownFields.includes("日期"));
  assert.ok(pack.unknownFields.includes("地點"));
  assert.equal(pack.concepts[0].qrPlacement.include, false);
  assert.equal(pack.generatedImage, false);
  assert.equal(pack.rendered, false);
  assert.equal(pack.publish, false);
  const blob = JSON.stringify(pack);
  assert.equal(blob.includes("私密電話"), false);
  assert.equal(/2026-1[0-2]-/.test(blob), false);
  assert.equal(pack.concepts[0].ctaPlacement.copy, null);
  assert.ok(pack.notice.includes("UNKNOWN") || pack.notice.includes("不完整"));
  for (const concept of pack.concepts) {
    assert.equal(concept.generatedImage, false);
    assert.ok(concept.negativePrompt.includes("watercolor"));
    assert.ok(concept.negativePrompt.includes("cheap Canva template"));
    assert.ok(concept.imagePrompt.includes("Do not invent"));
    assert.equal(/寺廟|香爐/.test(concept.imagePrompt), false);
  }
  assert.notEqual(pack.concepts[0].mainSubject.kind, pack.concepts[1].mainSubject.kind);
  assert.notEqual(pack.concepts[1].mainSubject.kind, pack.concepts[2].mainSubject.kind);
});

test("confirmed facts can overlay; QR only when registration is public", () => {
  const saved = saveActivity(
    "workspace",
    {
      projectId: "personal",
      expectedRevision: 0,
      operationId: randomUUID(),
      title: "TEST ONLY 迎新",
      facts: [
        fact("name", "115 迎新茶會"),
        fact("date", "待查日期"),
        fact("location", "淡水校園"),
        fact("registration", "https://forms.gle/example"),
      ],
    },
    "owner",
  );
  const nameId = saved.facts.find((item) => item.field === "name")!.id;
  const dateId = saved.facts.find((item) => item.field === "date")!.id;
  const locationId = saved.facts.find((item) => item.field === "location")!.id;
  const registrationId = saved.facts.find(
    (item) => item.field === "registration",
  )!.id;
  const confirmed = confirmFacts("workspace", saved.id, saved.revision, [
    nameId,
    dateId,
    locationId,
    registrationId,
  ]);
  const pack = visualConceptsFor("workspace", confirmed.id, "ig_story");
  assert.equal(pack.format.width, 1080);
  assert.equal(pack.format.height, 1920);
  assert.equal(pack.overlayText.name, "115 迎新茶會");
  assert.equal(pack.overlayText.date, "待查日期");
  assert.equal(pack.overlayText.location, "淡水校園");
  assert.equal(pack.concepts[0].qrPlacement.include, true);
  assert.equal(pack.concepts[0].ctaPlacement.copy, "https://forms.gle/example");
  assert.match(pack.concepts[2].layout.grid, /14%–78%|4:5/);
  assert.equal(pack.directions.length, 3);
  assert.equal(pack.directions[0].platform, "ig_story");
});

test("workspace_get_visual_concepts is a read tool and never claims a render", async () => {
  assert.equal(
    permissionClass("workspace_get_visual_concepts"),
    "read",
  );
  assert.ok(
    toolsList("workspace").some((item) => item.name === "workspace_get_visual_concepts"),
  );
  assert.equal(activityKind("workspace_get_visual_concepts"), "creative");
  assert.equal(
    toolDisplayLabel("workspace_get_visual_concepts"),
    "視覺 · 概念規格",
  );
  const saved = saveActivity(
    "workspace",
    {
      projectId: "personal",
      expectedRevision: 0,
      operationId: randomUUID(),
      title: "TEST ONLY 社博",
      facts: [fact("name", "社博攤位")],
    },
    "owner",
  );
  const result = await callTool(
    "workspace",
    "workspace_get_visual_concepts",
    {
      activityId: saved.id,
      format: "poster_a4",
      taskId: taskContext(),
    },
    "visual-1",
  );
  assert.equal(result.isError, false);
  const pack = (
    result as {
      structuredContent: {
        result: ReturnType<typeof visualConceptsFor>;
      };
    }
  ).structuredContent.result;
  assert.equal(pack.format.id, "poster_a4");
  assert.equal(pack.format.width, 2480);
  assert.equal(pack.generatedImage, false);
  assert.equal(pack.executableInCanva, false);
  const spec = directionToSpec(
    {
      title: "熱舞社迎新",
      claim: "週五練舞",
      visual: "體育館舞台燈光",
      copy: "熱舞社迎新，帶朋友來看一次就懂。",
      cta: "來看一次",
    },
    "notes",
    "ig_feed_4x5",
  );
  assert.equal(spec.width, 1080);
  assert.equal(spec.height, 1350);
  assert.equal(spec.imageKeywords.includes("tea"), false);
  assert.ok(spec.imageKeywords.includes("activity"));
});

test("design goals route through visual spec before Canva", () => {
  const goal = interpretGoal("幫我做淡江禪學社招生 IG 4:5 視覺");
  assert.equal(goal.requiresDesign, true);
  const routes = routeTools(goal, [
    emptyIntegration("tamkang"),
    emptyIntegration("hermes"),
    emptyIntegration("canva"),
  ]);
  assert.equal(
    routes.find((item) => item.id === "visual_spec")?.tool,
    "workspace_get_visual_concepts",
  );
  const plan = buildPlan(goal, routes);
  assert.ok(plan.steps.some((step) => step.title === "編譯視覺規格"));
});
