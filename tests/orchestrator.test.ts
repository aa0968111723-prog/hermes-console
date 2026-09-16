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
const { composeTaskInstructions } = await import(
  "../lib/server/orchestrator/instructions"
);
const { routeTools } = await import("../lib/server/orchestrator/tool-router");
const { buildPlan } = await import("../lib/server/orchestrator/planner");
const { shouldFastPlan } = await import("../lib/server/orchestrator/intent");
const { composeTaskInstructions } = await import(
  "../lib/server/orchestrator/instructions"
);
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
    assert.equal(
      plan.steps.find((step) => step.title === "找靈感")?.tool,
      "workspace_search_inspiration",
    );
    assert.equal(
      plan.steps.find((step) => step.title === "受眾模擬")?.tool,
      "workspace_simulate_audience",
    );
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

  await t.test("Hermes picks GALLEY, Lumen, FrameLab when they are actually usable", () => {
    const hermes = emptyIntegration("hermes");
    hermes.capabilities.find((item) => item.id === "hermes.api")!.status =
      "reachable";
    const inspiration = interpretGoal("幫我找淡江大學禪學社最近適合的網宣靈感");
    const galleyRoutes = routeTools(
      inspiration,
      [emptyIntegration("tamkang"), hermes, emptyIntegration("canva")],
      { galley: "partial" },
    );
    assert.equal(galleyRoutes.find((item) => item.id === "galley")?.tool, "galley_research");
    const galleyPlan = buildPlan(inspiration, galleyRoutes, "balanced");
    assert.ok(galleyPlan.steps.some((step) => step.title === "研究情報"));
    assert.equal(
      galleyPlan.steps.find((step) => step.title === "研究情報")?.tool,
      "galley_research",
    );
    assert.equal(
      JSON.stringify(galleyPlan.steps.map((step) => step.title)).includes("galley_research"),
      false,
    );

    const poster = interpretGoal("幫我做一張淡江新生茶會宣傳");
    const lumenRoutes = routeTools(
      poster,
      [emptyIntegration("tamkang"), hermes, emptyIntegration("canva")],
      { lumen: "partial" },
    );
    assert.equal(lumenRoutes.find((item) => item.id === "lumen")?.tool, "lumen_utter");
    const lumenPlan = buildPlan(poster, lumenRoutes, "balanced");
    assert.ok(lumenPlan.steps.some((step) => step.title === "創作台"));
    assert.equal(lumenPlan.steps.find((step) => step.title === "創作台")?.tool, "lumen_utter");

    const animation = interpretGoal("幫我修 FrameLab 中間張");
    const framed = routeTools(animation, [hermes], { framelab: "partial" });
    assert.equal(framed.find((item) => item.id === "framelab")?.tool, "framelab_list_projects");

    const booth = interpretGoal("幫我排迎新攤位場佈");
    const layout = routeTools(booth, [hermes], { planform: "partial" });
    assert.equal(layout.find((item) => item.id === "planform")?.tool, "planform_run_agent");

    const unconfigured = routeTools(poster, [
      emptyIntegration("tamkang"),
      hermes,
      emptyIntegration("canva"),
    ]);
    assert.equal(unconfigured.find((item) => item.id === "lumen"), undefined);
    assert.equal(unconfigured.find((item) => item.id === "galley"), undefined);
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
    for (const prompt of ["淡江新生茶會", "淡江大一新生", "教心所研究倫理", "淡大禪學社茶會"]) {
      const goal = interpretGoal(prompt);
      assert.equal(goal.requiresTamkang, true, prompt);
      assert.equal(goal.audience, "淡江大一新生（模擬，不是民調）");
    }
  });

  await t.test("context budget does not dump the whole memory store", () => {
    for (let i = 0; i < 25; i++) {
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
    assert.equal(classifyResume(task, true), "running");
    assert.match(resumeNotice("unknown"), /尚未確認/);
    const submitting = { ...task, transport: "runs" as const, remoteId: null };
    assert.equal(classifyResume(submitting, true), "running");
    assert.equal(classifyResume(submitting, false), "unknown");
  });

  await t.test("poster image review routes visual and audience simulation", () => {
    const goal = interpretGoal("這張哪裡可以改？");
    assert.equal(goal.requiresImageReview, true);
    assert.equal(goal.requiresInspiration, false);
    assert.equal(goal.requiresDesign, true);
    assert.equal(goal.requiresAudienceEvaluation, true);
    const composed = composeTaskInstructions({
      mode: "creative",
      text: "這張哪裡可以改？",
      goal,
      hasImageAttachments: true,
    });
    assert.ok(composed.packs.includes("image"));
    assert.ok(composed.packs.includes("audience"));
    assert.ok(composed.packs.includes("visual"));
    assert.equal(composed.packs.includes("inspiration"), false);
    assert.equal(composed.packs.includes("canva"), false);
    assert.match(composed.instructions, /workspace_read_material/);
    assert.match(composed.instructions, /SIMULATION/);
    assert.equal(composed.instructions.includes("chain-of-thought"), false);
    const plan = buildPlan(goal, routeTools(goal, [emptyIntegration("hermes")]), "balanced");
    assert.ok(plan.steps.some((step) => step.title === "讀取附圖"));
    assert.ok(plan.steps.some((step) => step.title === "受眾模擬"));
    assert.ok(plan.steps.some((step) => step.title === "視覺修改建議"));
    assert.equal(
      plan.steps.find((step) => step.title === "找靈感"),
      undefined,
    );
    assert.equal(
      plan.steps.find((step) => step.title === "提出創作方向"),
      undefined,
    );
    assert.equal(
      plan.steps.find((step) => step.title.includes("Canva")),
      undefined,
    );
  });

  await t.test("untrusted Instagram URLs do not flip inspiration routing", async () => {
    const { wrapUntrusted } = await import("../lib/server/untrusted");
    const goal = interpretGoal(
      "台大大一新生攝影社\n\n" +
        wrapUntrusted(
          "saved_project_references",
          JSON.stringify([
            { sourceUrl: "https://www.instagram.com/p/NotAUserGoal/" },
          ]),
        ),
    );
    assert.equal(goal.requiresInspiration, false);
    assert.equal(goal.requiresDesign, false);
    assert.equal(goal.goal.startsWith("台大大一新生攝影社"), true);
  });
});

test("continue-this-work stays on the same artifact without exposing tools in the user line", () => {
  const copyId = "11111111-1111-1111-1111-111111111111";
  const goal = interpretGoal("請接續修改這個作品（第 2 版）。不要另做無關的新作品。", {
    focus: { copyId, revision: 2 },
  });
  assert.equal(goal.intentTier, "create");
  assert.equal(goal.requiresDesign, true);
  assert.match(goal.output || "", /同一作品/);
  const fast = interpretGoal("請接續修改這個作品（第 2 版）。不要另做無關的新作品。");
  assert.equal(fast.intentTier, "continue");
  const activityId = "22222222-2222-2222-2222-222222222222";
  const activityGoal = interpretGoal(
    "請依這個活動已確認的資訊提出三個方向，保存後等我選擇。私人資訊不得用於公開文宣。",
    { focus: { activityId } },
  );
  assert.equal(activityGoal.intentTier, "create");
  assert.match(activityGoal.output || "", /活動/);
});
