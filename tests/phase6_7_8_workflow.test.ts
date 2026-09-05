import assert from "node:assert";
import { PERSONAS, simulateAudienceReaction } from "../lib/server/audience-twin/engine.ts";
import { runCreativeIntelligencePipeline } from "../lib/server/creative-workflow/pipeline.ts";

console.log("🚀 開始執行 Phase 6, 7, 8 Audience Twin 與創意工作流 2.0 測試...\n");

// 1. Audience Twin 5 大 Persona 測試
console.log("▶ 測試 1: Audience Twin 5 大模擬角色結構");
assert.strictEqual(PERSONAS.length, 5, "必須包含 5 位不同視角之受眾角色");
const personaIds = PERSONAS.map((p) => p.id);
assert.ok(personaIds.includes("target_freshman"), "應包含核心目標新生");
assert.ok(personaIds.includes("bystander"), "應包含滑動旁觀者");
assert.ok(personaIds.includes("skeptic"), "應包含懷疑論者");
assert.ok(personaIds.includes("peer_advocate"), "應包含同儕推手");
assert.ok(personaIds.includes("creative_director"), "應包含創意總監");
console.log("  ✓ 5 大立體 Persona 註冊完整性通過");

// 2. 受眾雙生模擬與評分測試
console.log("▶ 測試 2: 受眾雙生模擬反饋與評分引擎");
const simulation = simulateAudienceReaction(
  "克難坡登頂後的 15 分鐘心靈茶席",
  "以大一新生每天爬 132 階克難坡的痛點為切入，提供免費清香冷泡茶與大一選課不踩雷攻略分享，保證零社交壓力。",
  "日系雜誌排版，留白充足，手作三色光道具印章置於右下角 36px，符合規範。",
  "到底誰發明了 132 階克難坡？爬上來的大一新生，這杯冷泡茶我們請你喝。"
);

assert.ok(simulation.scores.overallScore >= 80, "真實痛點切入應獲得 80 分以上評價");
assert.strictEqual(simulation.feedback.length, 5, "5 位 Persona 均需提供回饋");
assert.ok(simulation.evidencePoints.length >= 2, "需包含真實證據標籤");
assert.ok(simulation.hypothesisPoints.length >= 1, "需包含推論假設標籤");
assert.strictEqual(simulation.consensus, "strongly_recommended");
assert.strictEqual(simulation.disclaimer, "AI 模擬評估，不代表真實市場調查。");

// 驗證多輪辯論與共識收斂結構
assert.strictEqual(simulation.debateRounds?.length, 2, "必須包含 2 輪辯論過程 (Divergence & Convergence)");
assert.strictEqual(simulation.debateRounds[0].phase, "divergence", "第一輪必須為 Divergence 分歧碰撞");
assert.strictEqual(simulation.debateRounds[1].phase, "convergence", "第二輪必須為 Convergence 疑慮消解");
assert.ok(simulation.consensusConvergenceIndex! >= 80 && simulation.consensusConvergenceIndex! <= 100, "共識收斂指數需在 80-100 之間");

// 驗證客觀證據 vs 推論假設結構化事實 (Facts Provenance)
assert.ok(simulation.facts && simulation.facts.length >= 5, "需包含結構化事實出處清單");
const evidenceFacts = simulation.facts.filter((f) => f.kind === "evidence");
const hypothesisFacts = simulation.facts.filter((f) => f.kind === "hypothesis");
assert.ok(evidenceFacts.length >= 3, "需包含至少 3 條客觀證據");
assert.ok(hypothesisFacts.length >= 2, "需包含至少 2 條推論假設");
assert.ok(evidenceFacts.every((f) => f.sourceTag.startsWith("[")), "客觀證據必須標註清晰出處來源標籤");
assert.ok(hypothesisFacts.every((f) => f.sourceTag.startsWith("[")), "推論假設必須標註清晰推論模型標籤");

console.log(`  ✓ 模擬成功！綜合評分: ${simulation.scores.overallScore}/100，共識收斂指數: ${simulation.consensusConvergenceIndex}% (含多輪辯論與出處分離)`);

// 測試 AI Slop 扣分懲罰
const slopSimulation = simulateAudienceReaction(
  "探索心靈奧秘茶會",
  "在這個快節奏的時代，讓我們一起踏上這趟旅程，揭開神秘面紗，不容錯過！",
  "巨大三色光螢光漸層標誌置中",
  "期待您的光臨！"
);
assert.ok(slopSimulation.scores.overallScore < simulation.scores.overallScore, "包含 AI Slop 必須被扣分");
console.log(`  ✓ AI Slop 懲罰機制正常 (降至 ${slopSimulation.scores.overallScore}/100)`);

// 測試跨領域校園適配 (NTU Context vs Tamkang Context)
console.log("▶ 測試 2b: 跨領域受眾適配與校園地標無洩漏驗證 (NTU Context)");
const ntuSimulation = simulateAudienceReaction(
  "台大椰林大道迎新野餐交流會",
  "以大一新生椰林迷路與通識避雷為切入，提供免費冷泡茶與雙主修選課經驗分享，保證零社交壓力。",
  "日系雜誌排版，留白充足，手作三色光道具印章置於右下角 36px，符合規範。",
  "初到椰林大道總是在迷路嗎？給自己一杯冷泡茶的大腦重開機時間。",
  "ntu"
);

assert.ok(ntuSimulation.scores.overallScore >= 80, "NTU 痛點切入應獲得 80 分以上評價");
assert.strictEqual(ntuSimulation.feedback[0].name, "大一新生・宇軒 (電機系)", "應動態適配為台大電機系大一新生宇軒");
assert.ok(ntuSimulation.feedback[0].reaction.includes("台大") || ntuSimulation.feedback[0].reaction.includes("椰林"), "受眾反應應精準鎖定台大校園情境");

// 驗證無淡江地標事實洩漏 (No Leaks)
const ntuStatements = ntuSimulation.facts?.map((f) => f.statement).join(" ") || "";
assert.ok(!ntuStatements.includes("克難坡"), "NTU 模擬事實嚴禁洩漏淡江克難坡地標");
assert.ok(!ntuStatements.includes("福園"), "NTU 模擬事實嚴禁洩漏淡江福園地標");
assert.ok(ntuStatements.includes("椰林大道") || ntuStatements.includes("醉月湖"), "NTU 模擬事實應包含台大專屬地標證據");
console.log("  ✓ 跨校園領域動態適配正常，地標事實嚴格隔離無洩漏");

// 測試語意正則 AI Slop 同義句型攔截 (Synonym Pattern Interception)
console.log("▶ 測試 2c: 語意正則 AI Slop 同義句型攔截");
const synonymSlopSimulation = simulateAudienceReaction(
  "心靈之旅交流會",
  "開啟這段心靈之旅，揭曉不為人知的奧秘，萬萬不能錯過！帶你領略心靈的洗禮！",
  "螢光綠巨大漸層商標置中",
  "期待您的光臨！"
);
assert.ok(synonymSlopSimulation.scores.overallScore < 50, "同義 AI Slop 句型必須被正則精準識別並降至 50 分以下");
console.log(`  ✓ 語意正則成功攔截同義 AI Slop 句型 (降至 ${synonymSlopSimulation.scores.overallScore}/100)`);

// 測試校園關鍵字對數飽和防刷分 (Logarithmic Saturation)
console.log("▶ 測試 2d: 校園關鍵字對數飽和防刷分 (Keyword Stuffing Protection)");
const stuffedSimulation = simulateAudienceReaction(
  "克難坡 福園 宮燈教室 黑天鵝 選課 紅27 大一新生 冷泡茶 大腦重開機 專注放鬆 無社交壓力 不尷尬 活動中心",
  "大量堆砌真實關鍵字測試分數飽和度",
  "手作三色光道具 36px 印章於右下角",
  "冷泡茶"
);
assert.ok(stuffedSimulation.scores.overallScore <= 96, "即使堆砌 13 個關鍵字，綜合分數受對數飽和限制不得超過 96 分");
console.log(`  ✓ 對數飽和防刷分生效 (堆砌 13 個關鍵字得分 ${stuffedSimulation.scores.overallScore}/100，無異常衝頂)`);


// 3. 完整 Creative Intelligence Pipeline 2.0 端對端測試
console.log("▶ 測試 3: 全管線創意智能驅動測試");
async function testPipeline() {
  const result = await runCreativeIntelligencePipeline(
    "幫我做給淡江大學大一新生看的禪學社茶會網宣",
    { activeProject: "tku-zen-agent" }
  );

  assert.strictEqual(result.activeProject, "tku-zen-agent");
  assert.strictEqual(result.assignedProfile.id, "tku");
  assert.ok(result.contextMemories.length > 0, "應自動檢索淡江與禪學社記憶");
  assert.ok(result.directions.length >= 3, "應產生 3 個以上策略方向");

  const top = result.topDirection;
  assert.ok(top, "應選出第一名推薦方向");
  assert.ok(top.canvaBlueprint.layers.length >= 5, "Canva 藍圖應包含分層元素");
  assert.ok(top.canvaBlueprint.exportDraftUrl.includes("canva.com"), "應包含 Canva 匯出連結");

  // IG 文案檢驗
  assert.ok(top.igCaption.hook.length > 0, "應包含有力鉤子首句");
  assert.ok(top.igCaption.hashtags.includes("#淡江大學"), "應包含淡江大學標籤");
  assert.ok(top.igCaption.hashtags.includes("#克難坡日常"), "應包含克難坡標籤");

  // 安全二次確認 Token 檢驗
  assert.ok(result.actionConfirmation.token.startsWith("conf_"), "應準備敏感發布確認 Token");
  console.log("  ✓ 全管線端對端驅動完成！包含記憶檢索、MCP、Inspiration、Canva 藍圖與二次確認");

  // 4. 跨領域全管線端對端測試 (NTU Context)
  console.log("▶ 測試 4: 跨校園領域全管線端對端驅動測試 (NTU Context)");
  const ntuResult = await runCreativeIntelligencePipeline(
    "幫我做給臺灣大學大一新生看的野餐茶會網宣",
    { activeProject: "ntu" }
  );

  assert.strictEqual(ntuResult.assignedProfile.id, "ntu", "Profile 應自動指派為臺大校園脈絡專家");
  assert.strictEqual(ntuResult.assignedProfile.name, "臺大校園脈絡專家");
  assert.ok(ntuResult.directions.length >= 3, "應產生 3 個以上臺大專屬策略方向");
  assert.ok(ntuResult.topDirection.canvaBlueprint.layers[5].content?.includes("臺大"), "Canva 底部標籤應為臺大迎新");
  assert.ok(ntuResult.topDirection.igCaption.hashtags.includes("#臺灣大學"), "IG 標籤應包含 #臺灣大學");
  assert.ok(ntuResult.topDirection.igCaption.hashtags.includes("#椰林日常"), "IG 標籤應包含 #椰林日常");
  assert.ok(!ntuResult.topDirection.igCaption.hashtags.includes("#淡江大學"), "IG 標籤嚴禁洩漏 #淡江大學");
  assert.ok(!ntuResult.topDirection.igCaption.hashtags.includes("#克難坡日常"), "IG 標籤嚴禁洩漏 #克難坡日常");
  assert.ok(ntuResult.topDirection.igCaption.body.includes("椰林大道"), "IG 內文應包含椰林大道痛點");
  console.log("  ✓ 跨校園領域端對端管線驗證通過！無地標洩漏，圖層與社群標籤精確適配");
}

testPipeline().then(() => {
  console.log("\n🎉 Phase 6, 7, 8 全部核心測試 100% 通過！");
}).catch((err) => {
  console.error("測試失敗:", err);
  process.exit(1);
});

