import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-zenclub-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3221";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";

const { searchZenclubKnowledge, needsZenclubKnowledge, loadCatalog, loadGraph } =
  await import("../lib/server/zenclub");
const { interpretGoal } = await import("../lib/server/orchestrator/goal");
const { routeTools } = await import("../lib/server/orchestrator/tool-router");
const { buildPlan } = await import("../lib/server/orchestrator/planner");
const { emptyIntegration } = await import(
  "../lib/server/certification/registry"
);
const knowledgeRoute = await import("../app/api/knowledge/route");

function request(path: string, method = "GET", body?: unknown) {
  return new Request("http://localhost:3221/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("Drive catalog snapshot is not live and redacts rosters", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.source.live, false);
  assert.equal(catalog.source.folderId, "1H-GuCfVw51D5_ipAoivjboabhb7iaKt6");
  const rosters = catalog.files.filter((file) => file.docType === "roster");
  assert.ok(rosters.length >= 2);
  assert.ok(rosters.every((file) => file.piiRestricted));
  assert.ok(rosters.every((file) => file.extractStatus === "redacted"));
  const raw = readFileSync("data/zenclub/graph.json", "utf8");
  assert.equal(raw.includes("學號"), false);
  assert.equal(raw.includes("電話"), false);
});

test("115-1 tea party facts stay verified and venue stays unknown", () => {
  const result = searchZenclubKnowledge("期初茶會");
  const tea = result.hits.find((hit) =>
    hit.entity.id.includes("115-1-tea"),
  )?.entity;
  assert.ok(tea);
  const date = tea.claims.find((claim) => claim.field === "date");
  const place = tea.claims.find((claim) => claim.field === "place");
  assert.equal(date?.value, "2026-09-30");
  assert.equal(date?.status, "VERIFIED");
  assert.equal(place?.value, null);
  assert.equal(place?.status, "UNKNOWN");
  assert.equal(result.live, false);
  assert.ok(result.conflicts.some((item) => item.field === "tea_title"));
  const stale = result.hits.find((hit) =>
    hit.entity.title.includes("教授沒教的大腦休息法"),
  );
  assert.equal(stale?.entity.semester, "114-2");
});

test("lecture speaker is from the plan; location is not invented", () => {
  const result = searchZenclubKnowledge("生命靈數 期初演講");
  const lecture = result.hits.find((hit) =>
    hit.entity.id.includes("lecture"),
  )?.entity;
  assert.ok(lecture);
  assert.equal(
    lecture.claims.find((claim) => claim.field === "speaker")?.value,
    "盧玫竹老師",
  );
  assert.equal(
    lecture.claims.find((claim) => claim.field === "place")?.status,
    "UNKNOWN",
  );
  assert.equal(
    lecture.claims.find((claim) => claim.field === "date")?.value,
    "2026-10-07",
  );
});

test("fair booth days and 文館左側 come from the copy bank", () => {
  const result = searchZenclubKnowledge("社博攤位");
  const fair = result.hits.find((hit) =>
    hit.entity.id.includes("fair"),
  )?.entity;
  assert.ok(fair);
  assert.match(
    fair.claims.find((claim) => claim.field === "dates")?.value || "",
    /2026-09-10/,
  );
  assert.equal(
    fair.claims.find((claim) => claim.field === "place")?.value,
    "文館左側",
  );
});

test("knowledge routing is club-specific, not every tea party", () => {
  assert.equal(needsZenclubKnowledge("幫我做給淡江大一新生的期初茶會 IG"), true);
  assert.equal(needsZenclubKnowledge("禪學社社博攤位"), true);
  assert.equal(needsZenclubKnowledge("國立臺灣大學新生茶會文宣海報"), false);
  assert.equal(needsZenclubKnowledge("淡江大一新生通勤"), false);
  const goal = interpretGoal("幫我做給淡江大一新生的期初茶會 IG");
  const routes = routeTools(goal, [
    emptyIntegration("tamkang"),
    emptyIntegration("hermes"),
    emptyIntegration("canva"),
  ]);
  assert.equal(
    routes.find((item) => item.id === "club_knowledge")?.tool,
    "zenclub_drive_index",
  );
  const plan = buildPlan(goal, routes, "balanced");
  assert.ok(plan.steps.some((step) => step.title.includes("Drive")));
  const other = interpretGoal("國立臺灣大學新生茶會文宣海報");
  const otherRoutes = routeTools(other, [emptyIntegration("tamkang")]);
  assert.equal(
    otherRoutes.find((item) => item.id === "club_knowledge"),
    undefined,
  );
});

test("114-1 class archive is filename-likely and 生命靈數 is a series", () => {
  const flower = searchZenclubKnowledge("浮花禪光");
  assert.equal(
    flower.hits[0]?.entity.claims.find((claim) => claim.field === "date")?.status,
    "LIKELY",
  );
  const series = searchZenclubKnowledge("生命靈數");
  const years = new Set(series.hits.map((hit) => hit.entity.semester));
  assert.ok(years.has("115-1"));
  assert.ok(years.has("114-1"));
  const study = searchZenclubKnowledge("讀書不卡關");
  assert.ok(study.hits.some((hit) => hit.entity.id.includes("class-2")));
});

test("knowledge API returns snapshot search LOCAL_CONTRACT", async () => {
  const response = await knowledgeRoute.GET(request("knowledge?q=茶會"));
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.source.live, false);
  assert.ok(json.result.hits.length >= 1);
  assert.equal(json.result.forHermes.live, false);
  const posted = await knowledgeRoute.POST(
    request("knowledge", "POST", { q: "社博" }),
  );
  assert.equal(posted.status, 200);
  const graph = loadGraph();
  assert.ok(graph.entities.some((entity) => entity.id === "place:sg109"));
});
