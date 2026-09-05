import assert from "node:assert";
import {
  listAgentProfiles,
  getAgentProfile,
  getOrCreateSessionContext,
  searchMemories,
  addMemory,
  recordUsage,
  getUsageSummary,
  streamHermesChat
} from "../lib/server/hermes/index.ts";

console.log("🚀 開始執行 Phase 2 & 3 Multi-Profile 與記憶用量體系測試...\n");

// 1. Profile 註冊測試
console.log("▶ 測試 1: Agent Profiles 註冊完整性");
const profiles = listAgentProfiles();
assert.strictEqual(profiles.length >= 7, true, "應至少包含 7 個特化 Profile");
const tkuProfile = getAgentProfile("tku");
assert.strictEqual(tkuProfile.id, "tku");
assert.ok(tkuProfile.systemPrompt.includes("淡江大學"), "tku profile 應包含淡江大學特化提示詞");
assert.ok(tkuProfile.systemPrompt.includes("克難坡"), "應包含克難坡校園地標");
console.log("  ✓ Profiles 完整性驗證通過，成功註冊 7 大角色");

// 2. Session 隔離測試
console.log("▶ 測試 2: Session 隔離與上下文管理");
const session1 = getOrCreateSessionContext("project:tku-zen", { activeProject: "tku-zen-agent" });
const session2 = getOrCreateSessionContext("campaign:fall-welcome", { activeProject: "healing-studio" });
assert.notStrictEqual(session1.sessionKey, session2.sessionKey);
assert.strictEqual(session1.activeProject, "tku-zen-agent");
assert.strictEqual(session2.activeProject, "healing-studio");
console.log("  ✓ Session 鍵標準化與獨立上下文隔離通過");

// 3. 記憶庫檢索測試
console.log("▶ 測試 3: 專案記憶中心檢索");
const tkuMemories = searchMemories("大一新生 茶會 禪學社", "tku-zen-agent");
assert.ok(tkuMemories.length > 0, "應檢索出淡江新生或禪學社記憶");
assert.ok(tkuMemories.some(m => m.tags.includes("大一新生")), "應命中新生痛點標籤");
console.log(`  ✓ 成功檢索到 ${tkuMemories.length} 條淡江禪學社專案真實記憶`);

// 4. 用量中心記錄測試
console.log("▶ 測試 4: Observability 用量中心");
recordUsage({
  sessionKey: "project:tku-zen",
  profileId: "tku",
  model: "hermes-agent",
  promptTokens: 120,
  completionTokens: 80,
  totalTokens: 200,
  latencyMs: 350,
  toolCallsCount: 1,
  toolsUsed: ["query_tku_campus_info"]
});
const summary = getUsageSummary("project:tku-zen");
assert.ok(summary.totalCalls >= 1, "總調用次數應大於等於 1");
assert.ok(summary.totalTokens >= 200, "總 Token 數應正確累計");
assert.strictEqual(summary.topTools[0].tool, "query_tku_campus_info");
console.log("  ✓ 用量統計與工具排行榜累計正確");

// 5. 雙引擎串流測試 (本地沙盒備援)
console.log("▶ 測試 5: Hermes 雙引擎串流輸出 (本地高擬真沙盒)");
async function testStream() {
  const stream = streamHermesChat({
    messages: [{ role: "user", content: "幫我做給淡江大學大一新生看的禪學社茶會網宣" }],
    profileId: "tku",
    sessionKey: "project:tku-zen",
    forceLocal: true
  });

  let receivedStatus = false;
  let receivedContent = false;
  let totalChunks = 0;

  for await (const chunk of stream) {
    totalChunks++;
    if (chunk.includes("event: status")) receivedStatus = true;
    if (chunk.includes("data:") && chunk.length > 10) receivedContent = true;
    if (totalChunks > 15) break; // 取得足夠 chunk 即可驗證
  }

  assert.ok(receivedStatus, "串流應發送 status 事件");
  assert.ok(receivedContent, "串流應發送實質內容 chunk");
  console.log("  ✓ 雙引擎串流與事件調度驗證通過");
}

testStream().then(() => {
  console.log("\n🎉 Phase 2 & 3 全部核心項目 100% 通過！");
}).catch((err) => {
  console.error("測試失敗:", err);
  process.exit(1);
});
