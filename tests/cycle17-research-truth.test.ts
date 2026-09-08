import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-cycle17-research-truth-"),
);

const { interpretGoal } = await import("../lib/server/orchestrator/goal");
const { routeTools } = await import("../lib/server/orchestrator/tool-router");
const { buildPlan } = await import("../lib/server/orchestrator/planner");
const { fallbacksFromRoutes } = await import("../lib/server/orchestrator/fallback");
const { emptyIntegration } = await import("../lib/server/certification/registry");
const { classifyTruth } = await import("../lib/server/truth");
const { directionToSpec, revisionFromAudience } = await import(
  "../lib/server/creative/spec"
);

test("Cycle 17: general research routes to authorized web, not ask_user", () => {
  const goal = interpretGoal("研究 2026 年校園永續發展議題與國際案例");
  assert.equal(goal.requiresTamkang, false);
  assert.equal(goal.requiresResearch, true);

  const hermes = emptyIntegration("hermes");
  hermes.capabilities.find((item) => item.id === "hermes.api")!.status =
    "reachable";
  const ready = routeTools(goal, [emptyIntegration("tamkang"), hermes]);
  const research = ready.find((item) => item.id === "research");
  assert.ok(research);
  assert.equal(research.tool, "hermes_authorized_web");
  assert.equal(research.fallback, "official_web_directory");
  assert.equal(
    ready.find((item) => item.id === "campus"),
    undefined,
  );

  const plan = buildPlan(goal, ready, "balanced");
  const capability = plan.steps.find((step) => step.title === "確認資料來源能力");
  const lookup = plan.steps.find((step) => step.title === "查資料");
  assert.equal(capability?.tool, "hermes_authorized_web");
  assert.equal(capability?.fallback, "official_web_directory");
  assert.equal(lookup?.tool, "hermes_authorized_web");
  assert.equal(lookup?.fallback, "official_web_directory");

  const blocked = routeTools(goal, [
    emptyIntegration("tamkang"),
    emptyIntegration("hermes"),
  ]);
  const fallbackResearch = blocked.find((item) => item.id === "research");
  assert.equal(fallbackResearch?.tool, "ask_user");
  assert.equal(fallbackResearch?.fallback, "official_web_directory");
});

test("Cycle 17: retrieved without sourceIds is UNKNOWN, not FACT", () => {
  assert.equal(
    classifyTruth({ retrieved: true, sourceIds: ["https://www.tku.edu.tw/"] }),
    "SOURCE_VERIFIED",
  );
  assert.equal(classifyTruth({ retrieved: true }), "UNKNOWN");
  assert.equal(classifyTruth({ retrieved: true, sourceIds: [] }), "UNKNOWN");
  assert.notEqual(classifyTruth({ retrieved: true }), "FACT");
});

test("Cycle 17: Canva spec is not hardcoded to tea, temple, or incense", () => {
  const spec = directionToSpec(
    {
      title: "熱舞社迎新",
      claim: "週五練舞",
      visual: "體育館舞台燈光",
      copy: "熱舞社迎新，帶朋友來看一次就懂。",
      cta: "來看一次",
    },
    "notes",
  );
  const blob = JSON.stringify(spec);
  assert.equal(spec.imageKeywords.includes("tea"), false);
  assert.ok(spec.imageKeywords.includes("activity"));
  assert.equal(/寺廟|香爐|tea|金紅/.test(blob), false);

  const revision = revisionFromAudience("熱舞社迎新，帶朋友來看一次就懂。");
  assert.equal(/香爐|寺廟|來坐一下/.test(JSON.stringify(revision)), false);
  assert.match(revision.ctaRevision, /行動指引/);
});

test("Cycle 17: fallbacksFromRoutes records to as fallback, not identity", () => {
  const goal = interpretGoal(
    "幫我找靈感做三個方向，再整理成 Canva 可以繼續做的版本。",
  );
  const canva = emptyIntegration("canva");
  canva.capabilities.find((item) => item.id === "canva.list")!.status = "partial";
  const routes = routeTools(goal, [
    emptyIntegration("tamkang"),
    emptyIntegration("hermes"),
    canva,
  ]);
  const records = fallbacksFromRoutes(routes);
  for (const route of routes.filter((item) => item.fallback)) {
    const record = records.find(
      (item) => item.from === (route.id === "campus" ? "tamkang_mcp" : route.tool),
    );
    assert.ok(record, route.id);
    assert.equal(record.to, route.fallback || route.tool);
    assert.notEqual(record.to, record.from);
  }
});
