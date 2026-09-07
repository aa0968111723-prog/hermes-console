import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-orch-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3256";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";

const { interpretGoal } = await import("../lib/server/orchestrator/goal");
const { routeTools } = await import("../lib/server/orchestrator/tool-router");
const { buildPlan } = await import("../lib/server/orchestrator/planner");
const { fallbacksFromRoutes } = await import("../lib/server/orchestrator/fallback");
const { classifyResume, resumeNotice } = await import("../lib/server/orchestrator/recovery");
const { assembleContext } = await import("../lib/server/context/assembler");
const { saveMemory } = await import("../lib/server/memory");
const { emptyIntegration } = await import("../lib/server/certification/registry");
const { EMPTY_USAGE } = await import("../lib/contracts");
import type { Task } from "../lib/contracts";

test("goal interpreter and planner stay structured, not chain-of-thought", async (t) => {
  await t.test("freshman campaign becomes a visible plan", () => {
    const goal = interpretGoal(
      "幫我研究最近大一新生會喜歡什麼樣的禪學社招生內容，看一下我們以前的資料，找一些靈感，從淡江新生角度模擬，做三個方向，再整理成 Canva 可以繼續做的版本。",
    );
    assert.equal(goal.requiresTamkang, true);
    assert.equal(goal.requiresResearch, true);
    assert.equal(goal.requiresInspiration, true);
    assert.equal(goal.requiresAudienceEvaluation, true);
    assert.equal(goal.requiresDesign, true);
    assert.ok(goal.audience);
    assert.equal("thought" in goal, false);
    assert.equal("reasoning" in goal, false);
    const tamkang = emptyIntegration("tamkang");
    const hermes = emptyIntegration("hermes");
    hermes.capabilities.find((item) => item.id === "hermes.api")!.status = "reachable";
    const routes = routeTools(goal, [tamkang, hermes, emptyIntegration("canva")]);
    const campus = routes.find((item) => item.id === "campus")!;
    assert.equal(campus.tool, "hermes_authorized_web");
    const plan = buildPlan(goal, routes, "balanced");
    assert.ok(plan.steps.some((step) => step.title.includes("查資料")));
    assert.ok(plan.steps.some((step) => step.title.includes("靈感")));
    assert.ok(plan.steps.some((step) => step.title.includes("受眾")));
    assert.ok(plan.steps.some((step) => step.title.includes("Canva")));
    assert.ok(plan.fallbacks.some((item) => /淡江 MCP 暫時不可用/.test(item.userVisible)));
    assert.equal(JSON.stringify(plan).includes("chain-of-thought"), false);
  });

  await t.test("usable Tamkang MCP is chosen before asking the user", () => {
    const goal = interpretGoal("幫我查淡江新生茶會公告");
    const tamkang = emptyIntegration("tamkang");
    tamkang.capabilities.find((item) => item.id === "tamkang.reachable")!.status =
      "reachable";
    tamkang.capabilities.find((item) => item.id === "tamkang.tools")!.status = "partial";
    const routes = routeTools(goal, [tamkang, emptyIntegration("hermes")]);
    assert.equal(routes.find((item) => item.id === "campus")?.tool, "tamkang_mcp");
    assert.equal(fallbacksFromRoutes(routes).length, 0);
  });

  await t.test("context budget does not dump the whole memory store", () => {
    for (let i = 0; i < 12; i++) {
      saveMemory("workspace", {
        kind: "note",
        scope: "workspace",
        title: "無關筆記 " + i,
        content: "這是一段很長的無關內容。".repeat(40),
      });
    }
    saveMemory("workspace", {
      kind: "preference",
      scope: "workspace",
      title: "海報要明亮風",
      content: "以後海報都要明亮風。",
    });
    const packed = assembleContext({
      owner: "workspace",
      projectId: "personal",
      goalText: "幫我做明亮風新生海報",
      budgetMode: "fast",
    });
    assert.ok(packed.used <= packed.limit);
    assert.ok(packed.items.some((item) => item.title.includes("明亮風")));
    assert.ok(packed.items.length < 14);
  });

  await t.test("unknown resume never looks like a completed remote run", () => {
    const task = {
      id: "t",
      conversationId: "c",
      requestKey: "r",
      payloadHash: "h",
      state: "running",
      transport: "chat",
      remoteId: null,
      input: "x",
      attachments: [],
      output: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      endedAt: null,
      error: null,
      observationError: null,
      events: [],
      usage: { ...EMPTY_USAGE },
      stopSupported: false,
    } as Task;
    assert.equal(classifyResume(task, false), "unknown");
    assert.match(resumeNotice("unknown"), /尚未確認/);
  });
});
