import assert from "node:assert";
import {
  getAllIntegrationsReport,
  probeZeaburHermesStatus,
  probeCanvaStatus,
  probeTamkangMcpStatus,
  probeInstagramStatus,
  probePinterestStatus
} from "../lib/server/integrations/truth-status.ts";
import { executeOrchestratedTask } from "../lib/server/orchestrator/task-orchestrator.ts";

console.log("🚀 開始執行 Phase 9 任務編排器與真實整合健康度驗證測試...\n");

// 1. 生態系整合真實狀態測試 (Truthful Integrations Health)
console.log("▶ 測試 1: 生態系整合真實探測 (Truthful Integration Probes)");

const validStatuses = [
  "Connected",
  "Verified",
  "Partial",
  "Unconfigured",
  "Needs Authorization",
  "Unsupported",
  "Failed"
];

const canvaCheck = probeCanvaStatus();
assert.ok(validStatuses.includes(canvaCheck.status), `Canva 狀態必須為 7 大真實狀態之一: ${canvaCheck.status}`);
assert.ok(canvaCheck.capabilities.length > 0, "Canva 必須宣告支援能力");
console.log(`  ✓ Canva 探測正常: [${canvaCheck.status}] ${canvaCheck.statusBadge} - ${canvaCheck.details}`);

const igCheck = probeInstagramStatus();
assert.ok(validStatuses.includes(igCheck.status), `IG 狀態必須為 7 大真實狀態之一: ${igCheck.status}`);
console.log(`  ✓ Instagram 探測正常: [${igCheck.status}] ${igCheck.statusBadge}`);

const pinCheck = probePinterestStatus();
assert.ok(validStatuses.includes(pinCheck.status), `Pinterest 狀態必須為 7 大真實狀態之一: ${pinCheck.status}`);
console.log(`  ✓ Pinterest 探測正常: [${pinCheck.status}] ${pinCheck.statusBadge}`);

async function testAllIntegrations() {
  const report = await getAllIntegrationsReport();
  assert.strictEqual(report.integrations.length, 5, "應完整回傳 5 大生態系整合項目的真實狀態");
  for (const item of report.integrations) {
    assert.ok(validStatuses.includes(item.status), `整合項目 ${item.id} 狀態 ${item.status} 非法`);
    assert.ok(item.details.length > 0, `整合項目 ${item.id} 需附帶誠實細節描述`);
  }
  assert.ok(["healthy", "partial_ready", "needs_attention"].includes(report.overallHealth));
  console.log(`  ✓ 全域整合探測通過！當前健康度: ${report.overallHealth} (5/5 項目誠實回報)`);
}

// 2. 9 大子任務編排與來源出處 (Task Orchestrator & Provenance)
console.log("▶ 測試 2: 9 大子任務編排管線 (9-Stage Orchestration & Provenance)");

async function testOrchestrator() {
  const userPrompt = "幫我做給淡江大學大一新生看的禪學社茶會網宣";
  const result = await executeOrchestratedTask(userPrompt, {
    activeProject: "tku-zen-agent"
  });

  assert.strictEqual(result.status, "completed", "任務編排必須成功執行完成");
  assert.strictEqual(result.activeProject, "tku-zen-agent");
  assert.strictEqual(result.subtasks.length, 9, "必須精確包含 9 大子任務階段");

  const expectedSubtaskIds = [
    "memory_retrieval",
    "mcp_campus_research",
    "inspiration_search",
    "direction_generation",
    "audience_twin_simulation",
    "canva_draft_creation",
    "audience_reevaluation",
    "social_caption_draft",
    "action_confirmation"
  ];

  result.subtasks.forEach((st, idx) => {
    assert.strictEqual(st.subtaskId, expectedSubtaskIds[idx], `子任務順序不符: 預期 ${expectedSubtaskIds[idx]}, 得到 ${st.subtaskId}`);
    assert.strictEqual(st.status, "completed", `子任務 ${st.subtaskId} 必須為 completed`);
    assert.ok(st.durationMs >= 0, `子任務 ${st.subtaskId} 耗時必須非負數`);
    assert.ok(st.provenance.sourceOrigin.length > 0, `子任務 ${st.subtaskId} 必須包含明確來源出處 (Provenance)`);
  });
  console.log("  ✓ 9 大子任務循序編排與出處追蹤驗證通過");

  // 驗證真實證據與推論假設 (Evidence vs Hypothesis)
  const memoryTask = result.subtasks[0];
  assert.ok(memoryTask.evidenceVsHypothesis?.evidence.length! >= 1, "記憶階段需標記客觀證據");
  assert.ok(memoryTask.evidenceVsHypothesis?.hypotheses.length! >= 1, "記憶階段需標記推論假設");

  const mcpTask = result.subtasks[1];
  assert.ok(mcpTask.evidenceVsHypothesis?.evidence.length! >= 1, "校園調研需標記客觀證據");
  console.log("  ✓ 客觀證據 (Evidence) 與推論假設 (Hypothesis) 標記分離正確");

  // 驗證草稿完成後受眾再測驗報告 (Audience Re-evaluation)
  assert.ok(result.draftReevaluations.length >= 3, "應包含 3 個方向的受眾再測驗報告");
  const topReeval = result.draftReevaluations[0];
  assert.ok(topReeval.scoreDelta > 0, "落地藍圖經受眾再審應產生正面增益");
  assert.ok(topReeval.postDraftOverallScore >= topReeval.preDraftOverallScore);
  assert.strictEqual(topReeval.layerCritiques.length, 4, "必須包含 4 項圖層審查反饋");
  assert.ok(topReeval.layerCritiques.every((c) => c.passed), "所有草稿圖層審查必須符合受眾偏好通過");
  assert.strictEqual(topReeval.verdict, "Ready for Publication", "頂部方向結論應為 Ready for Publication");
  console.log(`  ✓ 草稿後受眾再測驗 (Audience Re-evaluation) 驗證通過: ${topReeval.preDraftOverallScore} -> ${topReeval.postDraftOverallScore} (+${topReeval.scoreDelta}%)`);

  // 驗證敏感操作二次確認 Token
  assert.ok(result.actionConfirmation.token.startsWith("conf_"), "安全二次確認 Token 必須合法簽發");
  assert.ok(result.actionConfirmation.expiresAt > Date.now(), "Token 必須處於有效期間");
  console.log(`  ✓ 敏感操作二次確認防護 Token 驗證通過: ${result.actionConfirmation.token.slice(0, 16)}...`);
}

Promise.all([testAllIntegrations(), testOrchestrator()])
  .then(() => {
    console.log("\n🎉 Phase 9 任務編排與真實整合健康度驗證 100% 全部通過！");
  })
  .catch((err) => {
    console.error("❌ 測試失敗:", err);
    process.exit(1);
  });
