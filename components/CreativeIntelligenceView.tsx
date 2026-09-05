"use client";

import { useState } from "react";
import type { CreativePipelineResult, CreativeDirection } from "@/lib/server/creative-workflow/pipeline.ts";

interface Props {
  initialPrompt?: string;
  onSelectProject?: (proj: string) => void;
  onSendChatMessage?: (msg: string) => void;
}

export default function CreativeIntelligenceView({
  initialPrompt = "幫我做給淡江大學大一新生看的禪學社茶會網宣",
  onSelectProject,
  onSendChatMessage
}: Props) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [activeProject, setActiveProject] = useState("tku-zen-agent");
  const [isRunning, setIsRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [pipelineData, setPipelineData] = useState<CreativePipelineResult | null>(null);
  const [activeDirIndex, setActiveDirIndex] = useState(0);

  // 敏感操作二次確認彈窗狀態
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmationToken, setConfirmationToken] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<any>(null);
  const [copyNotice, setCopyNotice] = useState("");

  const showToast = (msg: string) => {
    setCopyNotice(msg);
    setTimeout(() => setCopyNotice(""), 2500);
  };

  const handleRunPipeline = async (overridePrompt?: string) => {
    const query = (overridePrompt || prompt).trim();
    if (!query) return;

    setIsRunning(true);
    setStatusMessage("正在連結 Hermes 大腦與淡江專案記憶中心...");
    setPublishResult(null);

    try {
      setStatusMessage("正在調用淡江校園 MCP（行事曆、宮燈/福園場地與迎新脈絡）...");
      await new Promise((r) => setTimeout(r, 400));

      setStatusMessage("萬象靈感引擎：擷取淡水暮色、克難坡登頂日常與 Canva 模板結構...");
      await new Promise((r) => setTimeout(r, 400));

      setStatusMessage("Audience Twin 受眾雙生模擬：5 大 Persona（小涵、阿倫、廷宇、小琪、V導）即時評分中...");

      const res = await fetch("/api/creative/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: query,
          activeProject
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setPipelineData(data.pipeline);
      setActiveDirIndex(0);
      setConfirmationToken(data.pipeline.actionConfirmation?.token || "");
      showToast("✨ 創意智能全管線生成完成！");
    } catch (err: any) {
      alert(`管線執行失敗: ${err.message || String(err)}`);
    } finally {
      setIsRunning(false);
      setStatusMessage("");
    }
  };

  const handleOpenPublishModal = () => {
    if (!pipelineData) return;
    setConfirmationToken(pipelineData.actionConfirmation.token);
    setConfirmModalOpen(true);
  };

  const handleExecutePublish = async () => {
    if (!pipelineData) return;
    const currentDir = pipelineData.directions[activeDirIndex] || pipelineData.topDirection;

    setIsPublishing(true);
    try {
      const res = await fetch("/api/mcp/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "publish_social_campaign",
          args: {
            platform: "instagram",
            caption: currentDir.igCaption.hook + "\n\n" + currentDir.igCaption.body,
            confirmationToken,
            idempotencyKey: `publish_${Date.now()}`
          }
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "發布確認授權失敗");
      }

      setPublishResult(data.result);
      setConfirmModalOpen(false);
      showToast("🎉 已成功通過二次確認授權，文宣發布指令已推播至佇列！");
    } catch (err: any) {
      alert(`發布失敗: ${err.message}`);
    } finally {
      setIsPublishing(false);
    }
  };

  const currentDirection: CreativeDirection | null = pipelineData
    ? pipelineData.directions[activeDirIndex] || pipelineData.topDirection
    : null;

  return (
    <div className="creative-os-container">
      {copyNotice && <div className="toast-notification">{copyNotice}</div>}

      {/* 頂部英雄面板 */}
      <div className="os-hero-card">
        <div className="hero-badge-row">
          <span className="hero-pill-tag">✨ HERMES CREATIVE INTELLIGENCE OS</span>
          <span className="hero-pill-status">全自動 7 階段協同</span>
        </div>
        <h2 className="hero-title">淡江大學領袖禪學社・大一新生茶會網宣工作流</h2>
        <p className="hero-desc">
          零登入直接驅動：整合專案記憶庫、淡江 MCP 在地適配、萬象靈感引擎、Audience Twin 5 人受眾雙生模擬、Canva 設計草稿與安全社群發布審核機制。
        </p>

        {/* 快速提示詞輸入列 */}
        <div className="os-query-box">
          <div className="query-input-wrap">
            <span className="query-icon">💡</span>
            <input
              type="text"
              className="query-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="輸入創意任務需求..."
              disabled={isRunning}
            />
          </div>
          <button
            className="btn-run-pipeline"
            onClick={() => handleRunPipeline()}
            disabled={isRunning || !prompt.trim()}
          >
            {isRunning ? "智能推導中..." : "🚀 啟動全管線推導"}
          </button>
        </div>

        {/* 預設情境快捷標籤 */}
        <div className="preset-chips-row">
          <span className="preset-label">推薦情境：</span>
          <button
            className="preset-chip"
            onClick={() => {
              setPrompt("幫我做給淡江大學大一新生看的禪學社茶會網宣");
              handleRunPipeline("幫我做給淡江大學大一新生看的禪學社茶會網宣");
            }}
          >
            🌿 核心任務：淡江大一新生禪學社茶會網宣
          </button>
          <button
            className="preset-chip"
            onClick={() => {
              setPrompt("以克難坡 132 階爬坡腿酸為切入點，設計大一放鬆茶席文宣");
              handleRunPipeline("以克難坡 132 階爬坡腿酸為切入點，設計大一放鬆茶席文宣");
            }}
          >
            🧗 克難坡日常共鳴茶席
          </button>
          <button
            className="preset-chip"
            onClick={() => {
              setPrompt("規劃福園黑天鵝池畔午後慢活的高質感 IG 4:5 貼文與 Canva 草稿");
              handleRunPipeline("規劃福園黑天鵝池畔午後慢活的高質感 IG 4:5 貼文與 Canva 草稿");
            }}
          >
            🦢 福園池畔高顏值微光貼文
          </button>
        </div>
      </div>

      {/* 執行狀態條 */}
      {isRunning && (
        <div className="pipeline-running-banner">
          <span className="spinner" />
          <span className="running-text">{statusMessage}</span>
        </div>
      )}

      {/* 成果展示區塊 */}
      {pipelineData && currentDirection && (
        <div className="pipeline-dashboard">
          {/* 管線進度節點概覽 */}
          <div className="pipeline-stages-strip">
            <div className="stage-item done">
              <span className="stage-num">1</span>
              <span className="stage-label">專案記憶檢索</span>
              <span className="stage-meta">{pipelineData.contextMemories.length} 條命中</span>
            </div>
            <div className="stage-arrow">→</div>
            <div className="stage-item done">
              <span className="stage-num">2</span>
              <span className="stage-label">淡江 MCP 調用</span>
              <span className="stage-meta">第 2 週迎新時程</span>
            </div>
            <div className="stage-arrow">→</div>
            <div className="stage-item done">
              <span className="stage-num">3</span>
              <span className="stage-label">靈感與色票</span>
              <span className="stage-meta">低飽和自然光感</span>
            </div>
            <div className="stage-arrow">→</div>
            <div className="stage-item done">
              <span className="stage-num">4</span>
              <span className="stage-label">Audience Twin</span>
              <span className="stage-meta">5 大 Persona 模擬</span>
            </div>
            <div className="stage-arrow">→</div>
            <div className="stage-item done">
              <span className="stage-num">5</span>
              <span className="stage-label">Canva 草稿 + IG</span>
              <span className="stage-meta">{pipelineData.directions.length} 策略方向</span>
            </div>
          </div>

          {/* 策略方向選擇頁籤 */}
          <div className="direction-tabs-header">
            <div className="dir-tabs-title">
              <h3>🎯 策略創意方向提案 ({pipelineData.directions.length})</h3>
              <span className="dir-sub-note">依 Audience Twin 受眾雙生模擬綜合評分排序</span>
            </div>
            <div className="dir-tabs-list">
              {pipelineData.directions.map((dir, idx) => (
                <button
                  key={dir.id}
                  className={`dir-tab-btn ${idx === activeDirIndex ? "active" : ""}`}
                  onClick={() => setActiveDirIndex(idx)}
                >
                  <span className="dir-tab-rank">#{idx + 1}</span>
                  <span className="dir-tab-name">{dir.title}</span>
                  <span className="dir-tab-score">{dir.audienceScores.overallScore} 分</span>
                </button>
              ))}
            </div>
          </div>

          {/* 核心內容雙欄佈局 */}
          <div className="direction-content-grid">
            {/* 左欄：方向詳情、Canva 設計藍圖、IG 文案 */}
            <div className="grid-left-col">
              {/* 方向核心卡片 */}
              <div className="os-card dir-overview-card">
                <div className="dir-header-row">
                  <div>
                    <span className="card-badge">策略方向 #{activeDirIndex + 1}</span>
                    <h3 className="dir-heading">{currentDirection.title}</h3>
                    <p className="dir-subheading">{currentDirection.subtitle}</p>
                  </div>
                  <div className="overall-score-badge">
                    <span className="score-val">{currentDirection.audienceScores.overallScore}</span>
                    <span className="score-label">受眾評分</span>
                  </div>
                </div>

                <div className="insight-block">
                  <div className="insight-title">💡 核心受眾洞察 (Core Insight)</div>
                  <div className="insight-body">{currentDirection.coreInsight}</div>
                </div>

                <div className="hook-block">
                  <div className="hook-title">🎣 首句傳播鉤子 (Hook)</div>
                  <div className="hook-body">{currentDirection.hook}</div>
                </div>

                <div className="visual-block">
                  <div className="visual-title">🎨 視覺概念與三色光規範</div>
                  <div className="visual-body">{currentDirection.visualConcept}</div>
                  <div className="color-palette-strip">
                    {currentDirection.colorPalette.map((c) => (
                      <div key={c.hex} className="palette-item">
                        <span className="color-circle" style={{ backgroundColor: c.hex }} />
                        <span className="color-name">{c.name}</span>
                        <span className="color-hex">{c.hex}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Canva 設計草稿藍圖 */}
              <div className="os-card canva-blueprint-card">
                <div className="card-title-row">
                  <span className="card-icon">📐</span>
                  <h4>Canva 設計草稿分層藍圖</h4>
                  <span className="ratio-tag">{currentDirection.canvaBlueprint.dimensions}</span>
                </div>
                <div className="blueprint-layers-list">
                  {currentDirection.canvaBlueprint.layers.map((l) => (
                    <div key={l.layer} className="layer-row">
                      <span className="layer-idx">L{l.layer}</span>
                      <span className="layer-type">{l.type}</span>
                      <div className="layer-desc">
                        {l.content && <strong className="layer-content">{l.content}</strong>}
                        {l.note && <span className="layer-note">{l.note}</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="blueprint-actions">
                  <a
                    href={currentDirection.canvaBlueprint.exportDraftUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-open-canva"
                  >
                    在 Canva 畫布中開啟草稿藍圖 ↗
                  </a>
                  <button
                    className="btn-copy-blueprint"
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(currentDirection.canvaBlueprint, null, 2));
                      showToast("Canva 藍圖 JSON 已複製至剪貼簿！");
                    }}
                  >
                    複製藍圖 JSON
                  </button>
                </div>
              </div>

              {/* Instagram 社群文案排版 */}
              <div className="os-card ig-caption-card">
                <div className="card-title-row">
                  <span className="card-icon">📱</span>
                  <h4>Instagram / Threads 社群排版文案</h4>
                  <button
                    className="btn-copy-caption"
                    onClick={() => {
                      const fullCaption = [
                        currentDirection.igCaption.hook,
                        "",
                        currentDirection.igCaption.body,
                        "",
                        currentDirection.igCaption.eventLogistics,
                        "",
                        currentDirection.igCaption.callToAction,
                        "",
                        currentDirection.igCaption.hashtags.join(" ")
                      ].join("\n");
                      navigator.clipboard.writeText(fullCaption);
                      showToast("IG 完整文案已複製至剪貼簿！");
                    }}
                  >
                    一鍵複製完整文案 📋
                  </button>
                </div>

                <div className="caption-preview-box">
                  <div className="caption-hook">{currentDirection.igCaption.hook}</div>
                  <pre className="caption-body">{currentDirection.igCaption.body}</pre>
                  <pre className="caption-logistics">{currentDirection.igCaption.eventLogistics}</pre>
                  <div className="caption-cta">{currentDirection.igCaption.callToAction}</div>
                  <div className="caption-tags">
                    {currentDirection.igCaption.hashtags.map((tag) => (
                      <span key={tag} className="ig-tag">{tag}</span>
                    ))}
                  </div>
                </div>

                <div className="caption-publish-row">
                  <button className="btn-trigger-publish" onClick={handleOpenPublishModal}>
                    🛡️ 審核並發布此文宣 (需二次確認)
                  </button>
                  <span className="publish-hint">安全機制：受限於 Publish 權限階層，防止未經審核的意外推播</span>
                </div>
              </div>
            </div>

            {/* 右欄：Audience Twin 5 大 Persona 反饋與雷達評分 */}
            <div className="grid-right-col">
              <div className="os-card audience-twin-card">
                <div className="card-title-row">
                  <span className="card-icon">👥</span>
                  <div>
                    <h4>Audience Twin 受眾雙生模擬</h4>
                    <span className="card-sub-desc">5 位模擬角色即時評判與辯論共識</span>
                  </div>
                </div>

                {/* 雷達指標長條圖 */}
                <div className="score-bars-container">
                  <div className="score-bar-row">
                    <span className="bar-label">拇指停留率 (Stop Intent)</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${currentDirection.audienceScores.stopIntent}%` }} />
                    </div>
                    <span className="bar-val">{currentDirection.audienceScores.stopIntent}%</span>
                  </div>

                  <div className="score-bar-row">
                    <span className="bar-label">痛點關聯度 (Relevance)</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${currentDirection.audienceScores.relevance}%` }} />
                    </div>
                    <span className="bar-val">{currentDirection.audienceScores.relevance}%</span>
                  </div>

                  <div className="score-bar-row">
                    <span className="bar-label">同儕轉傳率 (Peer Affinity)</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${currentDirection.audienceScores.peerAffinity}%` }} />
                    </div>
                    <span className="bar-val">{currentDirection.audienceScores.peerAffinity}%</span>
                  </div>

                  <div className="score-bar-row">
                    <span className="bar-label">行動清晰度 (CTA Clarity)</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${currentDirection.audienceScores.ctaClarity}%` }} />
                    </div>
                    <span className="bar-val">{currentDirection.audienceScores.ctaClarity}%</span>
                  </div>

                  <div className="score-bar-row">
                    <span className="bar-label">無壓信賴感 (Safety Index)</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${currentDirection.audienceScores.safetyIndex}%` }} />
                    </div>
                    <span className="bar-val">{currentDirection.audienceScores.safetyIndex}%</span>
                  </div>
                </div>

                {/* 辯論共識與標籤拆解 */}
                <div className="debate-summary-box">
                  <div className="debate-title">📢 模擬受眾辯論共識結論</div>
                  <p className="debate-text">{currentDirection.audienceFeedback.debateSummary}</p>
                  <div className="evidence-hypothesis-row">
                    <div className="eh-column">
                      <span className="eh-tag verified">真實證據 Evidence</span>
                      <ul>
                        {currentDirection.audienceFeedback.evidencePoints.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="eh-column">
                      <span className="eh-tag hypothesis">推論假設 Hypothesis</span>
                      <ul>
                        {currentDirection.audienceFeedback.hypothesisPoints.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* 5 位 Persona 回饋卡片清單 */}
                <div className="personas-feedback-list">
                  <div className="personas-header">5 位虛擬受眾逐字評論：</div>
                  {currentDirection.audienceFeedback.feedback.map((f) => (
                    <div key={f.personaId} className="persona-quote-card">
                      <div className="persona-top">
                        <span className="persona-avatar">{f.avatar}</span>
                        <div className="persona-info">
                          <span className="persona-name">{f.name}</span>
                          <span className="persona-score">評分：{f.score} / 100</span>
                        </div>
                      </div>
                      <p className="persona-reaction">「{f.reaction}」</p>
                      <div className="persona-critique">
                        <strong>檢驗點：</strong>{f.critique}
                      </div>
                      <div className="persona-suggestion">
                        <strong>💡 建設性建議：</strong>{f.constructiveSuggestion}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 敏感操作二次確認彈窗 (Modal) */}
      {confirmModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <span className="modal-icon">🛡️</span>
              <h3>敏感操作二次確認 (Publish Confirmation)</h3>
            </div>
            <div className="modal-body">
              <p className="modal-warning">
                此操作將調用具有 <code>PUBLISH</code> 權限之 MCP 工具發布社群貼文。
                系統已核發一次性防篡改 Token，請確認以下發布資訊：
              </p>
              <div className="modal-meta-box">
                <div><strong>發布平台：</strong> Instagram & Canva Share</div>
                <div><strong>標題概念：</strong> {currentDirection?.title}</div>
                <div><strong>安全 Token：</strong> <code className="font-mono">{confirmationToken}</code></div>
                <div><strong>有效期限：</strong> 5 分鐘內單次有效</div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-cancel"
                onClick={() => setConfirmModalOpen(false)}
                disabled={isPublishing}
              >
                取消
              </button>
              <button
                className="btn-confirm-action"
                onClick={handleExecutePublish}
                disabled={isPublishing}
              >
                {isPublishing ? "正在安全驗證發布..." : "確認發布 (Consume Token)"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
