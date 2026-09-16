import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-accept-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3277";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
delete process.env.HERMES_IMAGE_INPUT;

const { interpretGoal } = await import("../lib/server/orchestrator/goal");
const { classifyIntent, isFastTier } = await import(
  "../lib/server/orchestrator/intent"
);
const { routeTools } = await import("../lib/server/orchestrator/tool-router");
const { buildPlan } = await import("../lib/server/orchestrator/planner");
const { emptyIntegration } = await import(
  "../lib/server/certification/registry"
);

test("acceptance prompts route without the user picking tools", async (t) => {
  await t.test("A: 禪學社網宣靈感 plans research and inspiration", () => {
    const prompt = "幫我找淡江大學禪學社最近適合的網宣靈感";
    assert.equal(isFastTier(classifyIntent(prompt)), false);
    const goal = interpretGoal(prompt);
    assert.equal(goal.requiresTamkang, true);
    assert.equal(goal.requiresResearch, true);
    assert.equal(goal.requiresInspiration, true);
    assert.equal(goal.requiresDesign, true);
    const hermes = emptyIntegration("hermes");
    hermes.capabilities.find((item) => item.id === "hermes.api")!.status =
      "reachable";
    const routes = routeTools(goal, [
      emptyIntegration("tamkang"),
      hermes,
      emptyIntegration("canva"),
    ]);
    const plan = buildPlan(goal, routes, "balanced");
    assert.ok(plan.steps.some((step) => step.title.includes("查資料")));
    assert.ok(plan.steps.some((step) => step.title.includes("靈感")));
    assert.ok(plan.steps.some((step) => step.title.includes("最終審查")));
    assert.equal(plan.steps.some((step) => step.title === "直接回覆"), false);
  });

  await t.test("B: uploaded poster asks for edits, not chitchat", () => {
    const prompt = "這張哪裡可以改？";
    assert.equal(classifyIntent(prompt), "create");
    assert.equal(classifyIntent(prompt, { hasImage: true }), "create");
    const goal = interpretGoal(prompt, { hasImage: true });
    assert.equal(goal.requiresImageAnalysis, true);
    assert.equal(goal.requiresDesign, true);
    assert.equal(goal.requiresAudienceEvaluation, true);
    assert.match(goal.constraints.join("\n"), /未讀圖/);
    const routes = routeTools(goal, [emptyIntegration("hermes")]);
    assert.equal(routes.find((item) => item.id === "image")?.tool, "ask_user");
    const plan = buildPlan(goal, routes, "balanced");
    assert.ok(plan.steps.some((step) => step.title === "看圖"));
    assert.ok(plan.fallbacks.some((item) => /尚未驗證看圖/.test(item.userVisible)));
  });

  await t.test("C: freshman tea poster plans research, copy, Canva spec", () => {
    const prompt = "幫我做一張淡江新生茶會宣傳";
    const goal = interpretGoal(prompt);
    assert.equal(goal.requiresTamkang, true);
    assert.equal(goal.requiresDesign, true);
    assert.equal(goal.requiresInspiration, true);
    assert.ok(goal.output);
    const hermes = emptyIntegration("hermes");
    hermes.capabilities.find((item) => item.id === "hermes.api")!.status =
      "reachable";
    const routes = routeTools(goal, [
      emptyIntegration("tamkang"),
      hermes,
      emptyIntegration("canva"),
    ]);
    assert.equal(routes.find((item) => item.id === "design")?.tool, "canva_spec_only");
    const plan = buildPlan(goal, routes, "balanced");
    assert.ok(plan.steps.some((step) => step.title.includes("查資料")));
    assert.ok(plan.steps.some((step) => /Canva/.test(step.title)));
    assert.ok(plan.fallbacks.some((item) => /Canva 尚未授權/.test(item.userVisible)));
  });

  await t.test("lookup about a tea notice stays research, not a poster mill", () => {
    const goal = interpretGoal("幫我查淡江新生茶會公告");
    assert.equal(goal.intentTier, "lookup");
    assert.equal(goal.requiresDesign, false);
    assert.equal(goal.requiresImageAnalysis, false);
  });
});
