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

  await t.test("GALLEY is used for research only when the registry is usable", () => {
    const goal = interpretGoal("幫我研究淡江新生最近可能喜歡的社團宣傳方向");
    const hermes = emptyIntegration("hermes");
    hermes.capabilities.find((item) => item.id === "hermes.api")!.status =
      "reachable";
    const without = routeTools(goal, [emptyIntegration("tamkang"), hermes]);
    assert.equal(without.find((item) => item.id === "galley"), undefined);
    const withGalley = routeTools(goal, [emptyIntegration("tamkang"), hermes], {
      galley: { status: "partial" },
    });
    assert.equal(withGalley.find((item) => item.id === "galley")?.tool, "galley_research");
    const plan = buildPlan(goal, withGalley, "balanced");
    assert.ok(plan.steps.some((step) => step.title.includes("來源優先研究")));
    const unconfigured = routeTools(goal, [emptyIntegration("tamkang"), hermes], {
      galley: { status: "unconfigured" },
    });
    assert.equal(unconfigured.find((item) => item.id === "galley"), undefined);
  });

  await t.test("Lumen is used for studio intent only when the registry is usable", () => {
    const goal = interpretGoal("幫我開 Lumen 畫板做招新海報三個方向");
    assert.equal(goal.requiresLumen, true);
    const hermes = emptyIntegration("hermes");
    const without = routeTools(goal, [emptyIntegration("tamkang"), hermes, emptyIntegration("canva")]);
    assert.equal(without.find((item) => item.id === "lumen"), undefined);
    const withLumen = routeTools(
      goal,
      [emptyIntegration("tamkang"), hermes, emptyIntegration("canva")],
      { lumen: { status: "partial" } },
    );
    assert.equal(withLumen.find((item) => item.id === "lumen")?.tool, "lumen_utter");
    const plan = buildPlan(goal, withLumen, "balanced");
    assert.ok(plan.steps.some((step) => step.title.includes("Lumen")));
    const failed = routeTools(
      goal,
      [emptyIntegration("tamkang"), hermes, emptyIntegration("canva")],
      { lumen: { status: "failed" } },
    );
    assert.equal(failed.find((item) => item.id === "lumen"), undefined);
  });

  await t.test("uploaded image critique leaves the fast path and reads the material", () => {
    const goal = interpretGoal("這張哪裡可以改？", {
      attachmentCount: 1,
      imageAttachmentCount: 1,
    });
    assert.equal(goal.requiresImageRead, true);
    assert.equal(goal.requiresAudienceEvaluation, true);
    assert.notEqual(goal.intentTier, "continue");
    assert.ok(goal.constraints.some((item) => /已上傳素材/.test(item)));
    const routes = routeTools(goal, [emptyIntegration("hermes")]);
    assert.equal(
      routes.find((item) => item.id === "image_read")?.tool,
      "workspace_read_material",
    );
    const plan = buildPlan(goal, routes, "balanced");
    assert.notEqual(plan.budgetMode, "fast");
    assert.ok(plan.steps.some((step) => step.title.includes("讀取上傳素材")));
    assert.ok(plan.steps.some((step) => step.title.includes("分析畫面")));
    assert.ok(plan.steps.some((step) => step.title.includes("受眾")));
  });

  await t.test("nth-version edits stay on the named revision", () => {
    const goal = interpretGoal("第二版字放大");
    assert.equal(goal.targetRevision, "v2");
    assert.notEqual(goal.intentTier, "continue");
    assert.ok(goal.constraints.some((item) => /v2/.test(item)));
    const plan = buildPlan(goal, [], "balanced");
    assert.ok(plan.steps.some((step) => step.title.includes("鎖定作品版本")));
    assert.match(plan.steps.find((step) => step.title.includes("鎖定"))!.purpose, /v2/);
    assert.equal(interpretGoal("第3版標題改短").targetRevision, "v3");
  });

  await t.test("orchestration counts uploaded images before routing", async () => {
    const { randomUUID } = await import("node:crypto");
    const { put } = await import("../lib/server/store");
    const { prepareOrchestration } = await import(
      "../lib/server/orchestrator/executor"
    );
    const id = randomUUID();
    put("material", "workspace", {
      id,
      projectId: "personal",
      title: "poster.png",
      kind: "image",
      url: null,
      mime: "image/png",
      bytes: 12,
      tags: [],
      createdAt: new Date().toISOString(),
      rights: "user_provided",
      notes: "",
    });
    const orch = prepareOrchestration(
      "workspace",
      {
        id: randomUUID(),
        conversationId: randomUUID(),
        requestKey: randomUUID(),
        payloadHash: "h",
        state: "queued",
        transport: "chat",
        remoteId: null,
        input: "這張哪裡可以改？",
        attachments: [id],
        output: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        endedAt: null,
        error: null,
        observationError: null,
        events: [],
        usage: { ...EMPTY_USAGE },
        stopSupported: false,
      },
      {
        id: randomUUID(),
        title: "測",
        projectId: "personal",
        messages: [],
        hermesSessionId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    );
    assert.equal(orch.goal.requiresImageRead, true);
    assert.equal(
      orch.routes.find((item) => item.id === "image_read")?.tool,
      "workspace_read_material",
    );
    assert.notEqual(orch.plan.budgetMode, "fast");
  });

  await t.test("generic freshman wording does not bind Tamkang", () => {
    for (const prompt of [
      "國立臺灣大學新生茶會文宣海報",
      "成功大學大一新生迎新茶會",
      "清華大學大一新生招新",
    ]) {
      const goal = interpretGoal(prompt);
      assert.equal(goal.requiresTamkang, false, prompt);
      assert.notEqual(goal.audience, "淡江大一新生（模擬，不是民調）");
      const tamkang = emptyIntegration("tamkang");
      tamkang.capabilities.find((item) => item.id === "tamkang.reachable")!.status =
        "reachable";
      const campus = routeTools(goal, [tamkang]).find((item) => item.id === "campus");
      assert.equal(campus, undefined, prompt);
    }
    for (const prompt of ["淡江新生茶會", "淡江大一新生", "教心所研究倫理"]) {
      const goal = interpretGoal(prompt);
      assert.equal(goal.requiresTamkang, true, prompt);
      assert.equal(goal.audience, "淡江大一新生（模擬，不是民調）");
    }
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
