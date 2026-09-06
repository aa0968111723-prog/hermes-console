import test from "node:test";
import assert from "node:assert/strict";
import { connectCreativeToCanva } from "../lib/server/creative/canva-workflow.ts";
import { runCreativeIntelligence } from "../lib/server/creative/pipeline.ts";
import { runCreativeIntelligencePipeline } from "../lib/server/creative-workflow/pipeline.ts";
import { executeMcpTool } from "../lib/server/mcp/registry.ts";

test("Phase 8 connect creative intelligence to Canva workflow", async (t) => {
  await t.test("unconfigured Canva stays a local blueprint and does not create a design", () => {
    const connected = connectCreativeToCanva({
      title: "克難坡登頂後的 15 分鐘心靈茶席",
      subtitle: "腿酸先歇會兒",
      copy: "免費冷泡茶與選課不踩雷",
      cta: "來坐一下",
      visual: "淡水晨光與陶茶碗",
      layers: [{ layer: 1, type: "headline", content: "克難坡茶席" }],
    });
    assert.equal(connected.created, false);
    assert.equal(connected.liveDesignId, null);
    assert.equal(connected.liveFetch, false);
    assert.equal(connected.executableInCanva, false);
    assert.ok(["unconfigured", "needs_authorization", "local_blueprint"].includes(connected.mode));
    assert.notEqual(connected.status, "Connected");
    assert.notEqual(connected.status, "Verified");
    assert.ok(!connected.openUrl.includes("/design/draft"));
    assert.ok(connected.openUrl.includes("canva.com"));
    assert.equal(connected.blueprint.created, false);
  });

  await t.test("thin pipeline Canva block is truthful", () => {
    const result = runCreativeIntelligence({
      prompt: "幫我做一個給淡江大一新生看的禪學社迎新茶會網宣",
    });
    assert.equal(result.canva.created, false);
    assert.equal(result.canva.liveDesignId, null);
    assert.match(String(result.canva.status), /unconfigured|Needs Canva|local_blueprint|partial/);
    assert.ok(!JSON.stringify(result.canva).includes("無縫導入"));
  });

  await t.test("creative OS blueprint is not a live Canva file", async () => {
    const os = await runCreativeIntelligencePipeline(
      "幫我做給淡江大學大一新生看的禪學社茶會網宣",
      { activeProject: "tku-zen-agent" },
    );
    assert.equal(os.topDirection.canvaBlueprint.created, false);
    assert.ok(os.topDirection.canvaBlueprint.exportDraftUrl.includes("canva.com"));
    assert.ok(!os.topDirection.canvaBlueprint.exportDraftUrl.includes("/design/draft?theme="));
    assert.ok((os.topDirection.canvaBlueprint.layers?.length || 0) >= 5);
  });

  await t.test("MCP Canva draft tool does not claim a live design when unconfigured", async () => {
    const draft = await executeMcpTool("create_canva_design_draft", {
      title: "淡江禪學社新生迎新茶會海報",
      dimensions: "1080x1350",
    });
    assert.equal(draft.success, true);
    const result = draft.result as { created?: boolean; liveDesignId?: string | null; canvaMode?: string; exportUrl?: string; message?: string };
    assert.equal(result.created, false);
    assert.equal(result.liveDesignId, null);
    assert.ok(!String(result.message).includes("無縫導入"));
    assert.ok(String(result.exportUrl).includes("canva.com"));
  });

  await t.test("MCP export_canva_design_draft supports png, jpg, pdf in truthful sandbox mode", async () => {
    const formats = ["png", "jpg", "pdf"] as const;
    for (const fmt of formats) {
      const res = await executeMcpTool("export_canva_design_draft", {
        designId: "blueprint_test_design",
        draftId: `test_draft_${fmt}`,
        format: fmt,
      });
      assert.equal(res.success, true);
      const data = res.result as {
        mode: string;
        format: string;
        draftId: string;
        exportUrl: string;
        previewDimensions: string;
        message: string;
      };
      assert.equal(data.mode, "sandbox_blueprint");
      assert.equal(data.format, fmt);
      assert.equal(data.previewDimensions, "1080x1350");
      assert.ok(data.exportUrl.includes(`format=${fmt}`));
      assert.ok(data.exportUrl.includes("canva.com/design/export_preview"));
      assert.match(data.message, /沙盒規格|未連線 Canva/);
    }
  });
});

