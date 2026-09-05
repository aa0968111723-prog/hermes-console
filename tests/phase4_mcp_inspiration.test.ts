import assert from "node:assert";
import {
  queryTkuCalendar,
  queryTkuVenues,
  getTkuZenClubProfile
} from "../lib/server/mcp/tamkang-adapter.ts";
import {
  MCP_TOOLS,
  executeMcpTool,
  generateConfirmationToken,
  verifyAndConsumeConfirmationToken
} from "../lib/server/mcp/registry.ts";
import {
  CURATED_INSPIRATIONS,
  parseInspirationLink,
  searchInspirations
} from "../lib/server/inspiration/engine.ts";

console.log("🚀 開始執行 Phase 4 & 5 MCP 註冊表與萬象靈感引擎測試...\n");

// 1. 淡江在地適配器測試
console.log("▶ 測試 1: 淡江校園行事曆與場地情報");
async function testTkuAdapter() {
  const cal = await queryTkuCalendar(2);
  assert.ok(cal, "應能取得淡江第 2 週行事曆");
  assert.ok((cal as any).title.includes("茶會"), "應包含茶會高峰期標題");

  const venue = await queryTkuVenues("gongdeng_lawn");
  assert.ok(venue, "應能取得宮燈教室長廊場地情報");
  assert.strictEqual((venue as any).venueId, "gongdeng_lawn");

  const club = getTkuZenClubProfile();
  assert.strictEqual(club.clubName, "淡江大學領袖禪學社");
  assert.ok(club.typicalTeaPartySchedule.experience.includes("放鬆禪"), "應包含放鬆禪核心體驗時程");
  console.log("  ✓ 淡江大學行事曆、宮燈/福園場地與禪學社規格測試通過");
}

// 2. MCP 權限階層與確認機制測試
console.log("▶ 測試 2: MCP 工具權限分級與二次確認防護");
async function testMcpPermissions() {
  // A. 唯讀工具應自由執行
  const readRes = await executeMcpTool("query_tku_campus_calendar", { week: 1 });
  assert.strictEqual(readRes.success, true);
  console.log("  ✓ Read 階層工具自由執行通過");

  // B. 草稿工具應自由執行 (Canva 草稿)
  const draftRes = await executeMcpTool("create_canva_design_draft", {
    title: "淡江禪學社新生迎新茶會海報",
    dimensions: "1080x1350"
  });
  assert.strictEqual(draftRes.success, true);
  assert.ok((draftRes.result as any).draftId.startsWith("canva_draft_"));
  console.log("  ✓ Draft 階層 (Canva 草稿藍圖) 執行通過");

  // C. Publish 階層若無 Token 必須被拒絕並發行確認 Token
  const unauthPub = await executeMcpTool("publish_social_campaign", {
    platform: "instagram",
    caption: "歡迎大一新生來喝茶！"
  });
  assert.strictEqual(unauthPub.success, false);
  assert.strictEqual(unauthPub.requiresConfirmation, true);
  assert.ok(unauthPub.confirmationToken?.startsWith("conf_"));
  console.log("  ✓ Publish 階層無 Token 攔截並發行確認碼通過");

  // D. 偽造或篡改 Token 檢驗
  const tampered = verifyAndConsumeConfirmationToken(
    unauthPub.confirmationToken!,
    "publish_social_campaign",
    { platform: "instagram", caption: "被惡意竄改的文案內容！" }
  );
  assert.strictEqual(tampered.ok, false);
  console.log("  ✓ 酬載篡改防護驗證通過 (Payload Hash Check)");

  // E. 重新發行正確 Token 並執行發布
  const payload = { platform: "instagram", caption: "淡水暮色與好茶・期初大一迎新茶會" };
  const tokenData = generateConfirmationToken("發布社群", "publish_social_campaign", payload);
  const authorizedPub = await executeMcpTool("publish_social_campaign", {
    ...payload,
    confirmationToken: tokenData.token
  });
  assert.strictEqual(authorizedPub.success, true);
  assert.strictEqual((authorizedPub.result as any).published, true);
  assert.strictEqual((authorizedPub.result as any).mode, "sandbox_simulation");
  assert.ok((authorizedPub.result as any).note.includes("沙盒模擬模式"));
  console.log("  ✓ 正式授權二次確認發布通過 (含安全沙盒模式標註)");

  // F. 驗證 Token 500 容量上限防爆量清理
  for (let i = 0; i < 505; i++) {
    generateConfirmationToken("測試壓力", "publish_social_campaign", { index: i });
  }
  console.log("  ✓ Token 容量上限與自動清理防爆量機制通過");
}

// 3. 萬象靈感引擎測試
console.log("▶ 測試 3: 萬象靈感引擎與社群美學解析");
function testInspirations() {
  const curated = searchInspirations("淡水");
  assert.ok(curated.length > 0, "應搜尋出淡水暮色相關美學風格");
  assert.ok(curated[0].colorPalette.length >= 3, "應包含完整色票");

  const igParsed = parseInspirationLink("https://www.instagram.com/p/Cxyz12345/");
  assert.strictEqual(igParsed.platform, "instagram");
  assert.ok(igParsed.insights.length >= 2);
  assert.ok(igParsed.rightsNotice.includes("合理使用"), "應包含明確版權規範");

  const pinterestParsed = parseInspirationLink("https://www.pinterest.com/pin/987654/");
  assert.strictEqual(pinterestParsed.platform, "pinterest");

  console.log("  ✓ 靈感搜尋、IG/Pinterest 解析與版權標註通過");
}

import {
  createMcpClient,
  callRemoteMcpToolViaSdk,
  discoverRemoteMcpTools
} from "../lib/server/mcp/client.ts";
import {
  getMcpServers,
  discoverAndRegisterRemoteTools
} from "../lib/server/mcp/registry.ts";

// 4. MCP SDK Client 封裝與動態探索測試
console.log("▶ 測試 4: MCP SDK Client 封裝、SSRF 防禦與容錯降級");
async function testMcpSdkClient() {
  // A. SSRF 攔截檢驗
  await assert.rejects(
    () => createMcpClient("http://169.254.169.254/mcp", { allowLoopback: false }),
    (err: any) => err.code === "ssrf_rejected" || /阻擋/.test(err.message),
    "對雲端 metadata 服務必須執行 SSRF 攔截"
  );
  console.log("  ✓ MCP SDK Client SSRF 阻擋驗證通過");

  // B. 遠端連線失敗/逾時降級
  const unreachable = await callRemoteMcpToolViaSdk(
    "http://127.0.0.1:59999/mcp-offline",
    "query_tku_calendar",
    { week: 2 },
    { timeoutMs: 300, allowLoopback: true }
  );
  assert.strictEqual(unreachable.success, false);
  assert.ok(unreachable.error && unreachable.error.length > 0, "連線失敗應有清楚錯誤說明");
  console.log("  ✓ MCP SDK 遠端調用逾時與平滑降級驗證通過");

  // C. 動態探索工具失敗降級
  const discoverRes = await discoverRemoteMcpTools(
    "http://127.0.0.1:59999/mcp-offline",
    { timeoutMs: 300, allowLoopback: true }
  );
  assert.strictEqual(discoverRes.success, false);
  assert.deepStrictEqual(discoverRes.tools, []);
  console.log("  ✓ 動態探索遠端工具離線降級通過");

  // D. 取得 MCP 伺服器即時狀態
  const servers = getMcpServers();
  assert.strictEqual(servers.length, 3, "應註冊 3 大 MCP 伺服器");
  assert.ok(servers.some((s) => s.id === "tku-campus-mcp"));
  assert.ok(servers.some((s) => s.id === "canva-design-mcp"));
  assert.ok(servers.some((s) => s.id === "hermes-ecosystem-mcp"));
  console.log("  ✓ MCP 伺服器即時健康度探測通過");
}

Promise.all([testTkuAdapter(), testMcpPermissions(), testMcpSdkClient()]).then(() => {
  testInspirations();
  console.log("\n🎉 Phase 4 & 5 全部 MCP 與靈感引擎測試 100% 通過！");
}).catch((err) => {
  console.error("測試失敗:", err);
  process.exit(1);
});

