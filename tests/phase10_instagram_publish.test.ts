import test from "node:test";
import assert from "node:assert/strict";
import {
  researchInstagramTrends,
  getCampusTrendingHashtags,
  getOptimalPostingSchedule,
  evaluateInstagramReadiness,
} from "../lib/server/social/instagram-research.ts";
import { executeMcpTool, MCP_TOOLS } from "../lib/server/mcp/registry.ts";
import {
  instagramPublishStatus,
  requestPublishConfirmation,
  confirmPublish,
} from "../lib/server/publish.ts";
import { metaPublisher, preparePublish } from "../lib/server/publish/contract.ts";
import { mintConfirmation } from "../lib/server/security.ts";

console.log("🚀 開始執行 Phase 10 Instagram 社群調研與 Publishing 加固單元測試...\n");

test("Instagram 社群調研引擎、時段模型與視覺規範 (Phase 10)", async (t) => {
  await t.test("1. 多校園熱門 Hashtag 趨勢分析與地標隔離", () => {
    // A. 淡江校園調研
    const tkuTrends = getCampusTrendingHashtags("tamkang");
    assert.ok(tkuTrends.recommendedSet.length >= 4, "淡江標籤集至少應包含 4 個推薦標籤");
    assert.ok(tkuTrends.recommendedSet.includes("#淡江大學"), "淡江標籤集應包含 #淡江大學");
    assert.ok(
      tkuTrends.all.some((h) => h.tag.includes("克難坡") || h.tag.includes("福園")),
      "淡江應包含校園特有地標標籤"
    );
    assert.ok(
      !tkuTrends.recommendedSet.some((tag) => tag.includes("椰林") || tag.includes("臺灣大學")),
      "淡江調研嚴禁洩漏臺大地標"
    );

    // B. 臺大校園調研
    const ntuTrends = getCampusTrendingHashtags("ntu");
    assert.ok(ntuTrends.recommendedSet.includes("#臺灣大學"), "臺大標籤集應包含 #臺灣大學");
    assert.ok(
      ntuTrends.all.some((h) => h.tag.includes("椰林") || h.tag.includes("醉月湖")),
      "臺大應包含椰林大道或醉月湖標籤"
    );
    assert.ok(
      !ntuTrends.recommendedSet.some((tag) => tag.includes("克難坡") || tag.includes("淡江")),
      "臺大調研嚴禁洩漏淡江地標"
    );

    // C. 通用大專青年調研
    const genTrends = getCampusTrendingHashtags("general");
    assert.ok(genTrends.recommendedSet.includes("#大學日常"), "通用標籤應包含 #大學日常");
    assert.ok(genTrends.recommendedSet.includes("#大一新生"), "通用標籤應包含 #大一新生");
    console.log("  ✓ 多校園熱門 Hashtag 趨勢與地標隔離驗證通過");
  });

  await t.test("2. 校園生活作息最佳發文時段分佈模型", () => {
    const slots = getOptimalPostingSchedule("tamkang");
    assert.strictEqual(slots.length, 3, "應包含 3 大核心生活時段");

    const lunchSlot = slots.find((s) => s.startHour === 12);
    assert.ok(lunchSlot, "應包含中午放空用餐時段");
    assert.strictEqual(lunchSlot?.formatRecommendation, "story_9_16");

    const goldenSlot = slots.find((s) => s.isPrimeGoldenHour);
    assert.ok(goldenSlot, "必須精確定義首選黃金時段");
    assert.strictEqual(goldenSlot?.name.includes("深夜宿舍黃金檔"), true);
    assert.strictEqual(goldenSlot?.reachWeight, 97);
    assert.strictEqual(goldenSlot?.formatRecommendation, "feed_portrait_4_5");

    // 驗證特定時間的 readiness 評估
    const nightDate = new Date(2026, 8, 6, 22, 15); // 22:15
    const nightEval = evaluateInstagramReadiness(nightDate);
    assert.strictEqual(nightEval.isGoldenHourNow, true);
    assert.strictEqual(nightEval.score, 98);
    assert.ok(nightEval.advice.includes("深夜宿舍黃金檔"));

    const classDate = new Date(2026, 8, 6, 10, 0); // 10:00 上課離峰
    const classEval = evaluateInstagramReadiness(classDate);
    assert.strictEqual(classEval.isGoldenHourNow, false);
    assert.strictEqual(classEval.score, 65);
    console.log("  ✓ 校園最佳發文時段模型與即時發布契合度驗證通過");
  });

  await t.test("3. 完整調研報告生成與視覺規範檢驗", () => {
    const report = researchInstagramTrends({
      domain: "tamkang",
      topic: "迎新茶會"
    });

    assert.strictEqual(report.domain, "tamkang");
    assert.strictEqual(report.visualGuidelines.recommendedAspectRatio, "4:5");
    assert.strictEqual(report.visualGuidelines.dimensions.width, 1080);
    assert.strictEqual(report.visualGuidelines.dimensions.height, 1350);
    assert.ok(report.visualGuidelines.craftStampRule.includes("36px"), "手作三色光邊角印章規範需符合 36px");
    assert.ok(report.disclaimer.includes("模擬評估"), "調研報告必須包含免責聲明");
    assert.notEqual(report.truthStatus.connected, true, "未探測 Graph 不得聲稱 Connected");
    assert.notEqual(report.dataSource, "meta_graph_api", "啟發式標籤模型不得標成 meta_graph_api");
    assert.ok(
      ["Partial", "Needs Authorization", "Unconfigured"].includes(report.truthStatus.status),
      `調研狀態必須誠實，不得為 Connected：${report.truthStatus.status}`,
    );
    console.log("  ✓ 完整調研報告生成與 4:5 視覺排版規範驗證通過");
  });
});

test("MCP 工具註冊與執行驗證 (Phase 10)", async (t) => {
  await t.test("1. research_instagram_trends 工具已註冊且權限為 read", () => {
    const tool = MCP_TOOLS.find((t) => t.name === "research_instagram_trends");
    assert.ok(tool, "MCP_TOOLS 必須包含 research_instagram_trends 工具");
    assert.strictEqual(tool?.permissionTier, "read", "調研工具應為唯讀 read 階層，無須確認 Token");
  });

  await t.test("2. executeMcpTool 執行 research_instagram_trends 成功", async () => {
    const res = await executeMcpTool("research_instagram_trends", {
      domain: "ntu",
      topic: "椰林大道迎新野餐"
    });
    assert.strictEqual(res.success, true);
    const report = res.result as any;
    assert.strictEqual(report.domain, "ntu");
    assert.ok(report.hashtags.recommendedSet.includes("#臺灣大學"));
    assert.ok(report.optimalPostingTimes.length >= 3);
    console.log("  ✓ MCP 工具 research_instagram_trends 執行正常");
  });
});

test("Instagram 發布真實狀態探測與安全發布加固 (Phase 10)", async (t) => {
  await t.test("1. 誠實狀態探測 (Truthful Probes)", () => {
    const originalToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const originalClientId = process.env.INSTAGRAM_CLIENT_ID;
    const originalSecret = process.env.INSTAGRAM_CLIENT_SECRET;
    const originalLive = process.env.ENABLE_LIVE_PUBLISH;

    try {
      // A. 未配置時
      delete process.env.INSTAGRAM_ACCESS_TOKEN;
      delete process.env.INSTAGRAM_CLIENT_ID;
      delete process.env.INSTAGRAM_CLIENT_SECRET;
      delete process.env.ENABLE_LIVE_PUBLISH;
      const unconf = instagramPublishStatus();
      assert.strictEqual(unconf.state, "unconfigured");
      assert.strictEqual(unconf.enabled, false);
      assert.strictEqual(unconf.authorized, false);

      // B. OAuth 憑證存在但未授權時
      process.env.INSTAGRAM_CLIENT_ID = "mock_client_id";
      process.env.INSTAGRAM_CLIENT_SECRET = "mock_secret";
      const oauthState = instagramPublishStatus();
      assert.strictEqual(oauthState.state, "needs_authorization");
      assert.strictEqual(oauthState.configured, true);
      assert.strictEqual(oauthState.enabled, false);

      // C. Access Token 存在但未啟用 live 時 (安全沙盒模式)
      process.env.INSTAGRAM_ACCESS_TOKEN = "mock_access_token";
      const sandboxState = instagramPublishStatus();
      assert.strictEqual(sandboxState.state, "sandbox");
      assert.strictEqual(sandboxState.authorized, true);
      assert.strictEqual(sandboxState.enabled, false);

      // D. 啟用 ENABLE_LIVE_PUBLISH 時
      process.env.ENABLE_LIVE_PUBLISH = "true";
      const liveState = instagramPublishStatus();
      assert.strictEqual(liveState.state, "ready");
      assert.strictEqual(liveState.enabled, true);
      assert.strictEqual(liveState.authorized, true);
    } finally {
      if (originalToken) process.env.INSTAGRAM_ACCESS_TOKEN = originalToken;
      else delete process.env.INSTAGRAM_ACCESS_TOKEN;
      if (originalClientId) process.env.INSTAGRAM_CLIENT_ID = originalClientId;
      else delete process.env.INSTAGRAM_CLIENT_ID;
      if (originalSecret) process.env.INSTAGRAM_CLIENT_SECRET = originalSecret;
      else delete process.env.INSTAGRAM_CLIENT_SECRET;
      if (originalLive) process.env.ENABLE_LIVE_PUBLISH = originalLive;
      else delete process.env.ENABLE_LIVE_PUBLISH;
    }
    console.log("  ✓ 4 大環境下 Instagram Truthful Probes 狀態驗證通過");
  });

  await t.test("2. metaPublisher.publish 冪等性防重複發布與沙盒審核軌跡", async () => {
    const payload = {
      caption: "淡江大學禪學社迎新茶會・放空好時光",
      mediaId: "media_img_12345",
      target: "ig:tku_zen",
    };

    // 1. 簽發合法 Token
    const conf = requestPublishConfirmation(payload);
    assert.ok(conf.token, "必須成功簽發 confirmationToken");

    const idempotencyKey = `idem_test_${Date.now()}`;

    // 2. 執行發布 (啟用沙盒模擬)
    const pubRes = await metaPublisher.publish({
      confirmationToken: conf.token,
      idempotencyKey,
      accountId: payload.target,
      media: payload.mediaId,
      caption: payload.caption,
      options: {
        allowSandboxSimulation: true,
      },
    });

    assert.strictEqual(pubRes.state, "sandbox_simulated");
    assert.strictEqual(pubRes.mode, "sandbox_audit_simulation");
    assert.ok(pubRes.id?.startsWith("sim_"));
    assert.strictEqual(pubRes.auditTrail?.idempotencyKey, idempotencyKey);
    assert.ok(pubRes.auditTrail?.disclaimer?.includes("安全沙盒模擬發布"));

    // 3. 測試冪等性防重複調用 (以相同 idempotencyKey 再次調用)
    const duplicateRes = await metaPublisher.publish({
      confirmationToken: "any_token_since_cached",
      idempotencyKey,
      accountId: payload.target,
      media: payload.mediaId,
      caption: payload.caption,
    });

    assert.strictEqual(duplicateRes.idempotentCached, true, "相同 idempotencyKey 必須命中防重發快取");
    assert.strictEqual(duplicateRes.id, pubRes.id, "重複請求應回傳相同工作代碼");
    console.log("  ✓ 敏感操作二次確認、沙盒審核日誌與冪等防重複發布驗證通過");
  });

  await t.test("3. preparePublish 契約維持與未開啟發布時安全攔截", () => {
    const prepared = preparePublish("ig:tku_zen", "茶會文案", "media_999");
    assert.strictEqual(prepared.status.enabled, false);
    assert.ok(prepared.preview);
    assert.strictEqual(prepared.preview.caption, "茶會文案");
    assert.ok(prepared.confirmation?.token);
    console.log("  ✓ preparePublish 契約與安全攔截驗證通過");
  });

  await t.test("4. UI 調研面板與發布審核卡片 (Audit Trail) 資料結構契約校驗", async () => {
    // 驗證 executeMcpTool("publish_social_campaign") 回傳資料契合 UI 需求
    const { generateConfirmationToken } = await import("../lib/server/mcp/registry.ts");
    const confToken = generateConfirmationToken("發布測試", "publish_social_campaign", {
      platform: "instagram",
      caption: "淡江大一新生迎新文宣測試",
    });
    const mcpRes = await executeMcpTool("publish_social_campaign", {
      platform: "instagram",
      caption: "淡江大一新生迎新文宣測試",
      confirmationToken: confToken.token,
      idempotencyKey: "test_ui_idem_123",
    });

    assert.strictEqual(mcpRes.success, true);
    assert.ok(mcpRes.result);
    const result = mcpRes.result as any;
    assert.strictEqual(result.platform, "instagram");
    assert.strictEqual(result.idempotencyKey, "test_ui_idem_123");
    assert.strictEqual(result.mode, "sandbox_simulation");
    assert.ok(result.status.includes("安全沙盒"));
    assert.ok(result.auditTrail);
    assert.strictEqual(result.auditTrail.idempotencyKey, "test_ui_idem_123");
    assert.ok(result.auditTrail.disclaimer.includes("安全沙盒模擬發布"));

    // 驗證各校園 researchInstagramTrends 結構包含 UI 展開面板所須所有區塊
    for (const domain of ["tamkang", "ntu", "general"] as const) {
      const report = researchInstagramTrends({ domain });
      assert.strictEqual(typeof report.currentPostingReadiness.score, "number");
      assert.strictEqual(typeof report.currentPostingReadiness.advice, "string");
      assert.strictEqual(typeof report.currentPostingReadiness.isGoldenHourNow, "boolean");
      assert.ok(Array.isArray(report.optimalPostingTimes) && report.optimalPostingTimes.length === 3);
      for (const slot of report.optimalPostingTimes) {
        assert.ok(slot.name);
        assert.ok(slot.timeRange);
        assert.ok(typeof slot.reachWeight === "number");
        assert.ok(typeof slot.dwellTimeSec === "number");
        assert.ok(slot.formatRecommendation);
        assert.ok(slot.notes);
      }
      assert.strictEqual(report.visualGuidelines.recommendedAspectRatio, "4:5");
      assert.ok(report.visualGuidelines.craftStampRule.includes("36px"));
      assert.ok(report.truthStatus.message);
    }
    console.log("  ✓ UI 調研面板與發布審核卡片資料結構契約校驗通過");
  });
});
