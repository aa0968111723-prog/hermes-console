import test from "node:test";
import assert from "node:assert/strict";
import { prepareSafeSocialPublish } from "../lib/server/publish/safe-workflow.ts";
import { runCreativeIntelligence } from "../lib/server/creative/pipeline.ts";
import { executeMcpTool, generateConfirmationToken } from "../lib/server/mcp/registry.ts";
import { runCreativeIntelligencePipeline } from "../lib/server/creative-workflow/pipeline.ts";

test("Phase 9 safe social publishing workflow", async (t) => {
  await t.test("prepare never auto-publishes or claims live Graph", () => {
    const prepared = prepareSafeSocialPublish({
      caption: "淡江禪學社迎新茶會，來坐一下",
      title: "克難坡茶席",
      copy: "免費冷泡茶",
      cta: "來坐一下",
    });
    assert.equal(prepared.published, false);
    assert.equal(prepared.livePosted, false);
    assert.equal(prepared.autoRetry, false);
    assert.equal(prepared.requiresConfirmation, true);
    assert.ok(prepared.confirmation.token);
    assert.equal(prepared.drafts.publish, false);
    assert.notEqual(prepared.status.state, "ready");
    assert.ok(!JSON.stringify(prepared).includes("live_published"));
  });

  await t.test("creative pipeline publish workflow stays disabled without live Graph", () => {
    const result = runCreativeIntelligence({
      prompt: "幫我做一個給淡江大一新生看的禪學社迎新茶會網宣",
    });
    assert.equal(result.publish.enabled, false);
    assert.equal(result.publish.workflow.published, false);
    assert.equal(result.publish.workflow.livePosted, false);
    assert.equal(result.social.publish, false);
  });

  await t.test("MCP sandbox confirm does not mark a live post", async () => {
    const payload = { platform: "instagram", caption: "淡水暮色與好茶・期初大一迎新茶會" };
    const tokenData = generateConfirmationToken("發布社群", "publish_social_campaign", payload);
    const pub = await executeMcpTool("publish_social_campaign", {
      ...payload,
      confirmationToken: tokenData.token,
    });
    assert.equal(pub.success, true);
    const body = pub.result as { published?: boolean; livePosted?: boolean; mode?: string };
    assert.equal(body.published, false);
    assert.equal(body.livePosted, false);
    assert.equal(body.mode, "sandbox_simulation");
  });

  await t.test("OS pipeline attaches a confirmation-gated publish preview", async () => {
    const os = await runCreativeIntelligencePipeline(
      "幫我做給淡江大學大一新生看的禪學社茶會網宣",
      { activeProject: "tku-zen-agent" },
    );
    assert.equal(os.safePublish?.published, false);
    assert.equal(os.safePublish?.livePosted, false);
    assert.equal(os.safePublish?.requiresConfirmation, true);
    assert.ok(os.actionConfirmation.token.startsWith("conf_"));
  });
});
