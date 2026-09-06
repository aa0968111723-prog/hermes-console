import test from "node:test";
import assert from "node:assert/strict";
import { researchBundle } from "../lib/server/research/providers.ts";
import { runResearchAudienceDirectionWorkflow } from "../lib/server/creative/research-direction-workflow.ts";
import { runCreativeIntelligencePipeline } from "../lib/server/creative-workflow/pipeline.ts";
import { runCreativeIntelligence } from "../lib/server/creative/pipeline.ts";

test("Phase 7 research, audience, and creative direction workflow", async (t) => {
  await t.test("research bundle is domain-aware and does not leak Tamkang into NTU", () => {
    const tku = researchBundle({ prompt: "淡江大一新生", mcpReachable: false });
    assert.equal(tku.domain, "tamkang");
    assert.equal(tku.fallback, "web_research");
    assert.ok(tku.sources.some((item) => item.url.includes("tku.edu.tw")));
    assert.ok(tku.queries.includes("克難坡"));
    assert.ok(tku.claims.some((item) => item.kind === "hypothesis"));

    const ntu = researchBundle({ prompt: "幫我做給臺灣大學大一新生看的野餐茶會網宣" });
    assert.equal(ntu.domain, "ntu");
    assert.ok(ntu.sources.every((item) => item.url.includes("ntu.edu.tw")));
    assert.ok(!ntu.queries.includes("克難坡"));
    assert.ok(ntu.claims.some((item) => item.claim.includes("臺灣大學")));
    assert.ok(!JSON.stringify(ntu.claims).includes("淡水"));
  });

  await t.test("workflow ranks domain directions using audience scores and research facts", () => {
    const workflow = runResearchAudienceDirectionWorkflow({
      prompt: "幫我做給淡江大學大一新生看的禪學社茶會網宣",
      projectId: "tku-zen-agent",
    });
    assert.deepEqual(workflow.connected, ["research", "audience", "directions"]);
    assert.equal(workflow.simulation, true);
    assert.equal(workflow.method, "ai_heuristic");
    assert.equal(workflow.domain, "tamkang");
    assert.ok(workflow.ranked.length >= 3);
    assert.ok(workflow.topDirection.overallScore >= workflow.ranked[workflow.ranked.length - 1].overallScore);
    assert.ok(workflow.audienceFacts.some((fact) => fact.kind === "evidence"));
    assert.ok(workflow.research.sources.some((item) => item.url.includes("tku.edu.tw")));
  });

  await t.test("NTU workflow directions stay on NTU landmarks", () => {
    const workflow = runResearchAudienceDirectionWorkflow({
      prompt: "幫我做給臺灣大學大一新生看的野餐茶會網宣",
      projectId: "ntu",
    });
    assert.equal(workflow.domain, "ntu");
    const blob = JSON.stringify(workflow.ranked.map((item) => item.raw));
    assert.ok(blob.includes("椰林") || blob.includes("醉月湖"));
    assert.ok(!blob.includes("克難坡"));
    assert.ok(!blob.includes("福園"));
  });

  await t.test("creative pipelines expose the connected workflow", async () => {
    const os = await runCreativeIntelligencePipeline(
      "幫我做給淡江大學大一新生看的禪學社茶會網宣",
      { activeProject: "tku-zen-agent" },
    );
    assert.equal(os.researchAudienceWorkflow?.connected.includes("research"), true);
    assert.equal(os.researchAudienceWorkflow?.method, "ai_heuristic");
    assert.equal(os.research?.domain, "tamkang");
    assert.ok(os.directions[0].audienceScores.overallScore >= os.directions[os.directions.length - 1].audienceScores.overallScore);

    const thin = runCreativeIntelligence({
      prompt: "幫我做一個給淡江大一新生看的禪學社迎新茶會網宣",
    });
    assert.equal(thin.research.domain, "tamkang");
    assert.equal(thin.researchAudienceWorkflow.connected.length, 3);
    assert.equal(thin.profile.institution, "淡江大學");
  });
});
