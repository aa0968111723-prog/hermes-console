import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-phase4-insp-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3220";

const {
  CURATED_INSPIRATIONS,
  parseInspirationLink,
  searchInspirations,
  searchInspiration,
  runInspirationPipeline,
  resolveInspirationUrl,
} = await import("../lib/server/inspiration/engine.ts");
const { providerHealth, instagramProvider, pinterestProvider, canvaProvider } =
  await import("../lib/server/inspiration/providers.ts");
const { parseInspirationQuery } = await import("../lib/server/inspiration/query.ts");
const { ingestUrl, listInspiration } = await import("../lib/server/inspiration.ts");
const { executeOrchestratedTask } = await import(
  "../lib/server/orchestrator/task-orchestrator.ts"
);

test("Phase 4 truthful universal inspiration pipeline", async (t) => {
  await t.test("curated palettes are console fixtures, not live web trends", () => {
    assert.ok(CURATED_INSPIRATIONS.length >= 3);
    for (const item of CURATED_INSPIRATIONS) {
      assert.equal(item.sourceKind, "console_fixture");
      assert.equal(item.liveFetch, false);
      assert.equal(item.fetchedAt, null);
      assert.equal(item.fullSiteSearch, false);
      assert.ok(item.rightsNote.includes("console_fixture"));
    }
  });

  await t.test("domain search never leaks another campus landmark palette", () => {
    const ntu = searchInspirations("淡水", "ntu");
    assert.ok(ntu.length > 0);
    assert.ok(ntu.every((item) => item.domain === "ntu"));
    const ntuText = JSON.stringify(ntu);
    assert.ok(!ntuText.includes("克難坡"));
    assert.ok(!ntuText.includes("福園"));
    assert.ok(!ntuText.includes("淡水暮色"));

    const tku = searchInspirations("椰林", "tamkang");
    assert.ok(tku.every((item) => item.domain === "tamkang"));
    const tkuText = JSON.stringify(tku);
    assert.ok(!tkuText.includes("椰林大道"));
    assert.ok(!tkuText.includes("醉月湖"));

    const miss = searchInspirations("zzzz-no-such-style");
    assert.equal(miss.length, 0);
  });

  await t.test("URL classification does not fetch or invent live palettes from the page", () => {
    const ig = parseInspirationLink("https://www.instagram.com/p/Cxyz12345/");
    assert.equal(ig.platform, "instagram");
    assert.equal(ig.fetched, false);
    assert.equal(ig.liveContent, null);
    assert.equal(ig.extractionMode, "heuristic_not_fetched");
    assert.ok(ig.insights.length >= 2);
    assert.ok(ig.rightsNotice.includes("合理使用"));
    assert.ok(ig.insights.some((line) => /未抓取/.test(line)));
    const paletteText = JSON.stringify(ig.extractedPalette);
    assert.ok(!paletteText.includes("克難坡"));

    const pin = parseInspirationLink("https://www.pinterest.com/pin/987654/");
    assert.equal(pin.platform, "pinterest");
    assert.equal(pin.fetched, false);
  });

  await t.test("providers never claim Instagram/Pinterest full-site or live fetch", () => {
    assert.equal(instagramProvider.capabilities().globalSearch, false);
    assert.equal(instagramProvider.capabilities().liveFetch, false);
    assert.equal(pinterestProvider.capabilities().globalSearch, false);
    assert.equal(pinterestProvider.capabilities().liveFetch, false);
    assert.equal(canvaProvider.capabilities().liveFetch, false);
    const health = providerHealth();
    assert.ok(health.every((item) => item.capabilities.liveFetch === false));
    assert.ok(health.every((item) => item.capabilities.globalSearch === false));
    const ig = health.find((item) => item.id === "instagram");
    const pin = health.find((item) => item.id === "pinterest");
    assert.notEqual(ig?.state, "available");
    assert.notEqual(pin?.state, "available");
  });

  await t.test("unified pipeline labels fixtures and does not claim full-site search", () => {
    const ntuQuery = parseInspirationQuery("幫我找臺大新生野餐文宣靈感");
    assert.equal(ntuQuery.target, "NTU freshman");
    const pipeline = runInspirationPipeline({
      prompt: "幫我找臺大新生野餐文宣靈感",
      projectId: "ntu",
    });
    assert.equal(pipeline.fullSiteSearch, false);
    assert.equal(pipeline.liveFetch, false);
    assert.equal(pipeline.fetchedAt, null);
    assert.equal(pipeline.domain, "ntu");
    assert.ok(pipeline.fixtures.every((item) => item.domain === "ntu"));
    assert.ok(pipeline.fixtures.every((item) => item.sourceKind === "console_fixture"));
    const blob = JSON.stringify(pipeline);
    assert.ok(!blob.includes("克難坡"));
    assert.ok(!blob.includes("Connected"));
    assert.ok(!blob.includes("Verified"));
    assert.match(pipeline.notice, /未授權|未執行|不假裝|console_fixture/);
  });

  await t.test("saved URL ingest stays user_url and rejects SSRF", () => {
    assert.throws(
      () => ingestUrl({ url: "http://127.0.0.1/secret", projectId: "personal" }),
      /HTTPS|網址/,
    );
    const item = resolveInspirationUrl({
      url: "https://www.instagram.com/p/Phase4Pin/",
      projectId: "personal",
      caption: "茶會",
    });
    assert.equal(item.platform, "instagram");
    assert.equal(item.sourceType, "user_url");
    assert.ok(item.borrow.length > 0);
    assert.ok(item.fit.includes("借鑑"));
    const listed = listInspiration("personal");
    const found = listed.find((entry) => entry.sourceUrl.includes("Phase4Pin"));
    assert.ok(found);
    assert.ok(found.borrow.length > 0);
    assert.ok(found.fit.includes("借鑑"));
    const search = searchInspiration({ prompt: "幫我找靈感", projectId: "personal" });
    assert.equal(search.fullSiteSearch, false);
    assert.equal(search.liveFetch, false);
    assert.ok(search.items.some((entry) => entry.sourceUrl.includes("Phase4Pin")));
  });

  await t.test("orchestrator inspiration subtask uses console_style_library provenance", async () => {
    const result = await executeOrchestratedTask("幫我做給臺灣大學大一新生看的野餐茶會網宣", {
      activeProject: "ntu",
    });
    const insp = result.subtasks.find((item) => item.subtaskId === "inspiration_search");
    assert.equal(insp?.provenance.sourceOrigin, "console_style_library");
    assert.ok(insp?.provenance.rightsOrAttribution?.includes("console_fixture"));
    assert.ok(insp?.outputSummary?.includes("未宣稱"));
    const data = JSON.stringify(insp?.outputData || []);
    assert.ok(!data.includes("克難坡"));
    assert.ok(!data.includes("福園"));
  });
});
