import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-phase12-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3250";
delete process.env.CONSOLE_USERNAME;
delete process.env.CONSOLE_PASSWORD_HASH;
delete process.env.TKU_MCP_URL;
delete process.env.ENABLE_LIVE_PUBLISH;

const { executeOrchestratedTask } = await import(
  "../lib/server/orchestrator/task-orchestrator.ts"
);
const { runInspirationPipeline } = await import(
  "../lib/server/inspiration/engine.ts"
);
const { simulateAudienceReaction } = await import(
  "../lib/server/audience-twin/engine.ts"
);
const { runReverseThinkingEvaluation } = await import(
  "../lib/server/audience-twin/reverse-thinking.ts"
);
const { runResearchAudienceDirectionWorkflow } = await import(
  "../lib/server/creative/research-direction-workflow.ts"
);
const { connectCreativeToCanva } = await import(
  "../lib/server/creative/canva-workflow.ts"
);
const { prepareSafeSocialPublish } = await import(
  "../lib/server/publish/safe-workflow.ts"
);
const { getAllIntegrationsReport } = await import(
  "../lib/server/integrations/truth-status.ts"
);
const { MOBILE_CREATIVE_PANES } = await import(
  "../lib/client/mobile-workspace.ts"
);
const workspace = await import("../app/api/workspace/route.ts");
const healthRoute = await import("../app/api/health/route.ts");

const TAMKANG_PROMPT = "幫我做給淡江大學大一新生看的禪學社茶會網宣";
const NTU_PROMPT = "幫我做給臺灣大學大一新生看的野餐茶會網宣";

function request(path: string) {
  return new Request("http://localhost:3250/api/" + path, {
    method: "GET",
    headers: { Origin: process.env.CONSOLE_ORIGIN! },
  });
}

test("Phase 12 full system acceptance scenarios 1-7", async (t) => {
  await t.test("1. Zero-login workspace opens without Connected/Verified fakes", async () => {
    assert.equal((await workspace.GET(request("workspace"))).status, 200);
    assert.equal((await healthRoute.GET(request("health"))).status, 200);
    const report = await getAllIntegrationsReport();
    for (const item of report.integrations) {
      assert.notEqual(item.status, "Connected");
    }
  });

  await t.test("2. Tamkang tea-party prompt runs 9 orchestrated subtasks", async () => {
    const task = await executeOrchestratedTask(TAMKANG_PROMPT, {
      activeProject: "tku-zen-agent",
    });
    assert.equal(task.status, "completed");
    assert.equal(task.subtasks.length, 9);
    assert.ok(task.directions.length >= 3);
    assert.ok(task.topDirection.title.includes("克難坡") || task.topDirection.hook.includes("茶"));
    assert.ok(task.actionConfirmation.token.startsWith("conf_"));
  });

  await t.test("3. Inspiration pipeline is console_fixture, not full-site search", () => {
    const pipeline = runInspirationPipeline({
      prompt: TAMKANG_PROMPT,
      projectId: "tku-zen-agent",
    });
    assert.equal(pipeline.fullSiteSearch, false);
    assert.equal(pipeline.liveFetch, false);
    assert.ok(pipeline.fixtures.every((item) => item.sourceKind === "console_fixture"));
  });

  await t.test("4. Audience Twin is heuristic and reverse-thinking starts with bystander", () => {
    const sim = simulateAudienceReaction(
      "克難坡登頂後的 15 分鐘心靈茶席",
      "免費冷泡茶與選課不踩雷，零社交壓力。",
      "手作三色光 36px",
      TAMKANG_PROMPT,
      "tku-zen-agent",
    );
    assert.equal(sim.simulation, true);
    assert.equal(sim.method, "ai_heuristic");
    assert.equal(sim.disclaimer, "AI 模擬評估，不代表真實市場調查。");
    assert.ok(sim.facts?.some((f) => f.kind === "evidence"));
    const reverse = runReverseThinkingEvaluation({
      prompt: "路人會不會滑掉？",
      conceptTitle: "改變自己，從靜定開始",
      description: "改變自己，從靜定開始。",
    });
    assert.equal(reverse.perspectives[0].personaId, "bystander");
    assert.equal(reverse.envelope.method, "ai_heuristic");
  });

  await t.test("5. Research, audience, and directions stay domain-scoped", () => {
    const tku = runResearchAudienceDirectionWorkflow({
      prompt: TAMKANG_PROMPT,
      projectId: "tku-zen-agent",
    });
    assert.deepEqual(tku.connected, ["research", "audience", "directions"]);
    assert.equal(tku.domain, "tamkang");
    const ntu = runResearchAudienceDirectionWorkflow({
      prompt: NTU_PROMPT,
      projectId: "ntu",
    });
    assert.equal(ntu.domain, "ntu");
    const ntuBlob = JSON.stringify(ntu.ranked.map((item) => item.raw));
    assert.ok(!ntuBlob.includes("克難坡"));
    assert.ok(ntuBlob.includes("椰林") || ntuBlob.includes("醉月湖"));
  });

  await t.test("6. Canva connection is a local blueprint, not a live design", () => {
    const canva = connectCreativeToCanva({
      title: "克難坡茶席",
      copy: "來坐一下",
      cta: "來坐一下",
      visual: "淡水晨光",
      layers: [{ layer: 1, type: "headline", content: "茶席" }],
    });
    assert.equal(canva.created, false);
    assert.equal(canva.liveDesignId, null);
    assert.equal(canva.executableInCanva, false);
    assert.ok(["unconfigured", "needs_authorization", "local_blueprint"].includes(canva.mode));
  });

  await t.test("7. Safe publish stays confirmation-gated and mobile panes exist", () => {
    const publish = prepareSafeSocialPublish({
      caption: "淡江禪學社迎新茶會",
      title: "茶席",
      copy: "免費冷泡茶",
      cta: "來坐一下",
    });
    assert.equal(publish.published, false);
    assert.equal(publish.livePosted, false);
    assert.equal(publish.requiresConfirmation, true);
    assert.equal(publish.autoRetry, false);
    assert.deepEqual(
      MOBILE_CREATIVE_PANES.map((pane) => pane.id),
      ["brief", "design", "copy", "audience"],
    );
  });
});
