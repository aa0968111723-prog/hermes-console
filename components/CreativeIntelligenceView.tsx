"use client";

import { useState, useEffect } from "react";
import type { CreativePipelineResult, CreativeDirection } from "@/lib/server/creative-workflow/pipeline.ts";
import type { OrchestratedTaskResult } from "@/lib/server/orchestrator/task-orchestrator.ts";
import type { IntegrationCheckResult } from "@/lib/server/integrations/truth-status.ts";
import type { PersonaProfile } from "@/lib/server/audience-twin/types.ts";
import type { InstagramResearchReport } from "@/lib/server/social/instagram-research.ts";
import type { ReverseThinkingResult } from "@/lib/server/audience-twin/reverse-thinking.ts";
import type { MemoryItem } from "@/lib/server/hermes/memory.ts";
import { PersonaCard } from "@/components/audience/AudienceCard.tsx";
import {
  MOBILE_CREATIVE_PANES,
  type MobileCreativePane,
} from "@/lib/client/mobile-workspace.ts";

interface Props {
  initialPrompt?: string;
  defaultProject?: string;
  onSelectProject?: (proj: string) => void;
  onSendChatMessage?: (msg: string) => void;
  onBack?: () => void;
}

export default function CreativeIntelligenceView({
  initialPrompt = "幫我做給淡江大學大一新生看的禪學社茶會網宣",
  defaultProject = "tku-zen-agent",
  onSelectProject,
  onSendChatMessage,
  onBack
}: Props) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [activeProject, setActiveProject] = useState(defaultProject);

  const [isRunning, setIsRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [pipelineData, setPipelineData] = useState<CreativePipelineResult | null>(null);
  const [orchestratedTask, setOrchestratedTask] = useState<OrchestratedTaskResult | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationCheckResult[]>([]);
  const [activeDirIndex, setActiveDirIndex] = useState(0);
  const [showSubtasks, setShowSubtasks] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobileCreativePane>("brief");

  // 受眾雙生 3 大視角（辯論評估 / 逆向思考 / 立體畫像）與資料狀態
  const [audienceTab, setAudienceTab] = useState<"feedback" | "reverse" | "personas">("feedback");
  const [activePersonas, setActivePersonas] = useState<PersonaProfile[]>([]);
  const [loadingPersonas, setLoadingPersonas] = useState(false);
  const [reverseThinkingMap, setReverseThinkingMap] = useState<Record<string, ReverseThinkingResult | null>>({});
  const [loadingReverse, setLoadingReverse] = useState(false);

  // 敏感操作二次確認彈窗與 IG 調研狀態
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmationToken, setConfirmationToken] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<any>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const [showIgResearch, setShowIgResearch] = useState(false);

  // Canva 草稿匯出控制器狀態
  const [exportFormat, setExportFormat] = useState<"png" | "jpg" | "pdf">("png");
  const [isExportingCanva, setIsExportingCanva] = useState(false);
  const [canvaExportResult, setCanvaExportResult] = useState<{
    mode?: string;
    format?: string;
    draftId?: string;
    jobId?: string;
    exportUrl?: string;
    previewDimensions?: string;
    message?: string;
  } | null>(null);

  // 專案大腦在地記憶庫狀態
  const [showMemoryHub, setShowMemoryHub] = useState(false);
  const [projectMemories, setProjectMemories] = useState<MemoryItem[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [showAddMemForm, setShowAddMemForm] = useState(false);
  const [newMemTitle, setNewMemTitle] = useState("");
  const [newMemContent, setNewMemContent] = useState("");
  const [newMemType, setNewMemType] = useState<"campus_context" | "audience" | "insight" | "guideline">("campus_context");
  const [isAddingMem, setIsAddingMem] = useState(false);

  const showToast = (msg: string) => {
    setCopyNotice(msg);
    setTimeout(() => setCopyNotice(""), 2500);
  };

  // 載入真實整合狀態
  useEffect(() => {
    fetch("/api/integrations/status")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.integrations)) {
          setIntegrations(data.integrations);
        }
      })
      .catch(() => {});
  }, []);

  const handleRunPipeline = async (overridePrompt?: string) => {
    const query = (overridePrompt || prompt).trim();
    if (!query) return;

    setIsRunning(true);
    setStatusMessage("正在連結 Hermes 大腦與淡江專案記憶中心...");
    setPublishResult(null);

    try {
      setStatusMessage("任務編排中：調用淡江校園 MCP、萬象靈感與 Audience Twin 雙生評分...");

      const res = await fetch("/api/orchestrator/task", {
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
      const task: OrchestratedTaskResult = data.task;
      setOrchestratedTask(task);

      // 同步轉換為 pipelineData 格式
      setPipelineData({
        query: task.userPrompt,
        executedAt: new Date(task.finishedAt).toISOString(),
        activeProject: task.activeProject,
        assignedProfile: task.assignedProfile || {
          id: "tku",
          name: "淡江校園脈絡專家",
          role: "Tamkang Campus Specialist & Creative Orchestrator"
        },

        contextMemories: (task.subtasks[0]?.outputData as any[]) || [],
        campusIntel: {
          currentWeekEvents: (task.subtasks[1]?.outputData as any)?.calendar,
          recommendedVenues: (task.subtasks[1]?.outputData as any)?.venues,
          clubProfile: (task.subtasks[1]?.outputData as any)?.clubProfile
        },
        inspirations: (task.subtasks[2]?.outputData as any[]) || [],
        directions: task.directions,
        topDirection: task.topDirection,
        actionConfirmation: task.actionConfirmation
      });

      setActiveDirIndex(0);
      setConfirmationToken(task.actionConfirmation?.token || "");
      showToast("✨ 9 大子任務全管線編排完成（含草稿後受眾再測驗）！");
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

  const handleExportCanvaDraft = async () => {
    if (!currentDirection) return;
    setIsExportingCanva(true);
    try {
      const res = await fetch("/api/mcp/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "export_canva_design_draft",
          args: {
            designId: "blueprint_mock_design_id",
            draftId: `draft_${currentDirection.id}_${exportFormat}`,
            format: exportFormat
          }
        })
      });
      const data = await res.json();
      if (data.success && data.result) {
        setCanvaExportResult(data.result);
        showToast(`Canva ${exportFormat.toUpperCase()} 草稿規格已順利產出！`);
      } else {
        showToast(data.error || "Canva 匯出請求失敗");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`連線失敗: ${msg}`);
    } finally {
      setIsExportingCanva(false);
    }
  };

  const currentDirection: CreativeDirection | null = pipelineData
    ? pipelineData.directions[activeDirIndex] || pipelineData.topDirection
    : null;

  const igReport: InstagramResearchReport | undefined =
    pipelineData?.instagramResearch ||
    (orchestratedTask?.subtasks?.find((s) => s.subtaskId === "social_caption_draft")?.outputData as any)?.instagramReport;

  // 載入當前方向校園脈絡對應的 5 大 PersonaProfile
  useEffect(() => {
    let cancelled = false;
    const domain =
      currentDirection?.audienceFeedback?.domain ||
      (activeProject.includes("ntu") ? "ntu" : activeProject.includes("personal") ? "general" : "tamkang");
    setLoadingPersonas(true);
    fetch(`/api/audience-twin/personas?domain=${encodeURIComponent(domain)}`, {
      credentials: "same-origin",
    })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.ok && Array.isArray(data.personas)) {
          setActivePersonas(data.personas);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingPersonas(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentDirection?.audienceFeedback?.domain, activeProject]);

  // 載入當前方向之逆向創意思考（路人滑掉風險與抗性分析）
  const fetchReverseThinking = async (dir: CreativeDirection) => {
    if (!dir || reverseThinkingMap[dir.id]) return;
    setLoadingReverse(true);
    try {
      const domain =
        dir.audienceFeedback?.domain ||
        (activeProject.includes("ntu") ? "ntu" : activeProject.includes("personal") ? "general" : "tamkang");
      const res = await fetch("/api/audience-twin/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptTitle: dir.title,
          description: dir.hook,
          visualNotes: dir.visualConcept,
          copyExcerpt: dir.igCaption?.body || "",
          domain,
          reverse: true,
        }),
      });
      const data = await res.json();
      if (data.ok && data.reverseThinking) {
        setReverseThinkingMap((prev) => ({
          ...prev,
          [dir.id]: data.reverseThinking,
        }));
      }
    } catch {
      // 容錯靜默處理
    } finally {
      setLoadingReverse(false);
    }
  };

  useEffect(() => {
    if (audienceTab === "reverse" && currentDirection && !reverseThinkingMap[currentDirection.id]) {
      fetchReverseThinking(currentDirection);
    }
  }, [audienceTab, currentDirection?.id]);

  // 載入當前專案的大腦記憶庫
  const loadProjectMemories = async (proj: string) => {
    setLoadingMemories(true);
    try {
      const res = await fetch(`/api/hermes/memory?project=${encodeURIComponent(proj)}`, {
        credentials: "same-origin",
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.memories)) {
        setProjectMemories(data.memories);
      }
    } catch {
      // 容錯靜默處理
    } finally {
      setLoadingMemories(false);
    }
  };

  useEffect(() => {
    loadProjectMemories(activeProject);
  }, [activeProject]);

  const handleInjectMemoryToPrompt = (mem: MemoryItem) => {
    const injection = `融入${mem.title}（${mem.tags.slice(0, 2).join("、")}）脈絡`;
    if (prompt.includes(injection)) {
      showToast("提示詞中已包含該記憶脈絡！");
      return;
    }
    setPrompt((prev) => (prev ? `${prev.trim()}，並${injection}` : injection));
    showToast(`已將「${mem.title}」注入提示詞！`);
  };

  const handleCreateMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemTitle.trim() || !newMemContent.trim()) {
      showToast("請填寫記憶標題與內容！");
      return;
    }
    setIsAddingMem(true);
    try {
      const res = await fetch("/api/hermes/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: activeProject,
          type: newMemType,
          title: newMemTitle.trim(),
          content: newMemContent.trim(),
          evidenceType: "campus_observation",
          tags: [
            activeProject === "ntu" ? "臺大在地" : activeProject === "personal" ? "通用大專" : "淡江在地",
            newMemType === "campus_context" ? "校園脈絡" : newMemType === "audience" ? "受眾洞察" : "核心價值"
          ]
        })
      });
      const data = await res.json();
      if (data.ok && data.memory) {
        setProjectMemories((prev) => [data.memory, ...prev]);
        setNewMemTitle("");
        setNewMemContent("");
        setShowAddMemForm(false);
        showToast("🎉 大腦記憶已成功儲存至專案記憶中心！");
      } else {
        showToast(data.error || "儲存記憶失敗");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`連線失敗: ${msg}`);
    } finally {
      setIsAddingMem(false);
    }
  };

  return (
    <div className="creative-os-container">
      {copyNotice && <div className="toast-notification">{copyNotice}</div>}

      {/* 頂部英雄面板 */}
      <div className="os-hero-card">
        <div className="hero-badge-row">
          {onBack && (
            <button
              type="button"
              className="btn-back-nav"
              onClick={onBack}
              title="返回對話工作台"
            >
              ← 返回對話
            </button>
          )}
          <span className="hero-pill-tag">✨ HERMES CREATIVE INTELLIGENCE OS</span>
          <span className="hero-pill-status">
            {orchestratedTask?.assignedProfile
              ? `${orchestratedTask.assignedProfile.name} 協同`
              : "全自動 9 階任務協同"}
          </span>
          <div className="project-switcher-pills">
            <button
              type="button"
              className={`proj-pill ${activeProject === "tku-zen-agent" ? "active" : ""}`}
              onClick={() => {
                setActiveProject("tku-zen-agent");
                onSelectProject?.("tku-zen-agent");
                showToast("已切換至淡江大學禪學社專案");
              }}
            >
              🏫 淡江專案
            </button>
            <button
              type="button"
              className={`proj-pill ${activeProject === "ntu" ? "active" : ""}`}
              onClick={() => {
                setActiveProject("ntu");
                onSelectProject?.("ntu");
                showToast("已切換至臺灣大學校園專案");
              }}
            >
              🚲 臺大專案
            </button>
            <button
              type="button"
              className={`proj-pill ${activeProject === "personal" ? "active" : ""}`}
              onClick={() => {
                setActiveProject("personal");
                onSelectProject?.("personal");
                showToast("已切換至個人 / 通用大專專案");
              }}
            >
              🎓 通用大專
            </button>
          </div>
        </div>
        <h2 className="hero-title">
          <span className="hero-title-full">
            {orchestratedTask?.domainMeta?.themeTitle || "淡江大學領袖禪學社・大一新生茶會網宣工作流"}
          </span>
          <span className="hero-title-short">創意工作流</span>
        </h2>
        <p className="hero-desc hide-on-mobile">
          零登入直接驅動：整合專案記憶庫、跨校園 MCP 在地適配、萬象靈感引擎、Audience Twin 5 人受眾雙生模擬、Canva 設計草稿與安全社群發布審核機制。
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
            🌿 淡江大一新生禪學社茶會網宣
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
          <button
            className="preset-chip"
            onClick={() => {
              setPrompt("以臺大椰林大道迎新與醉月湖畔微光野餐為靈感，設計大一放鬆茶會文宣");
              handleRunPipeline("以臺大椰林大道迎新與醉月湖畔微光野餐為靈感，設計大一放鬆茶會文宣");
            }}
          >
            🚴 臺大椰林湖畔迎新茶會
          </button>
          <button
            className="preset-chip"
            onClick={() => {
              setPrompt("針對大專院校大一新生開學適應與選課壓力，設計無負擔草坪靜心茶席網宣");
              handleRunPipeline("針對大專院校大一新生開學適應與選課壓力，設計無負擔草坪靜心茶席網宣");
            }}
          >
            ☕ 通用大專選課減壓茶席
          </button>
        </div>

        {/* 專案大腦在地記憶庫折疊面板 */}
        <div className="campus-memory-hub">
          <div className="memory-hub-toggle-row">
            <button
              type="button"
              className={`btn-toggle-memory-hub ${showMemoryHub ? "is-active" : ""}`}
              onClick={() => setShowMemoryHub(!showMemoryHub)}
            >
              <span className="hub-toggle-icon">🧠</span>
              <span className="hub-toggle-title">
                {activeProject === "ntu" ? "臺灣大學" : activeProject === "personal" ? "通用大專" : "淡江大學"}
                {" 專案大腦在地記憶庫 ("}
                {projectMemories.length}
                {" 筆在地智慧)"}
              </span>
              <span className="hub-toggle-chevron">{showMemoryHub ? "▲ 收合記憶" : "▼ 展開校園地標與洞察"}</span>
            </button>
          </div>

          {showMemoryHub && (
            <div className="memory-hub-expanded-panel">
              <div className="hub-panel-header">
                <div className="hub-header-left">
                  <span className="hub-badge">CONSOLE_SEED · 校園地標與隱性知識庫</span>
                  <span className="hub-subnote">點擊記憶卡片上的「➕ 注入」可一鍵將在地地標融入 Prompt 提示詞</span>
                </div>
                <button
                  type="button"
                  className="btn-open-add-mem"
                  onClick={() => setShowAddMemForm(!showAddMemForm)}
                >
                  {showAddMemForm ? "✕ 取消新增" : "➕ 新增在地觀察記憶"}
                </button>
              </div>

              {/* 新增記憶表單 */}
              {showAddMemForm && (
                <form className="add-memory-form" onSubmit={handleCreateMemory}>
                  <div className="form-row-grid">
                    <div className="form-group flex-2">
                      <label>記憶標題（地標 / 特色）</label>
                      <input
                        type="text"
                        value={newMemTitle}
                        onChange={(e) => setNewMemTitle(e.target.value)}
                        placeholder="例如：蛋捲廣場午後人潮、總圖前草坪野餐..."
                        disabled={isAddingMem}
                      />
                    </div>
                    <div className="form-group flex-1">
                      <label>記憶類型</label>
                      <select
                        value={newMemType}
                        onChange={(e) => setNewMemType(e.target.value as any)}
                        disabled={isAddingMem}
                      >
                        <option value="campus_context">🏫 校園脈絡地標</option>
                        <option value="audience">👥 受眾心理洞察</option>
                        <option value="insight">✨ 核心價值 USP</option>
                        <option value="guideline">🎨 視覺調性規範</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>記憶內容與社群觀察</label>
                    <textarea
                      rows={2}
                      value={newMemContent}
                      onChange={(e) => setNewMemContent(e.target.value)}
                      placeholder="簡述此地標或社群觀察對新生的意義，例如生活作息、踩雷抗性或最佳體驗..."
                      disabled={isAddingMem}
                    />
                  </div>
                  <div className="form-actions-row">
                    <button type="submit" className="btn-submit-memory" disabled={isAddingMem}>
                      {isAddingMem ? "儲存中..." : "💾 儲存至專案記憶庫"}
                    </button>
                    <button
                      type="button"
                      className="btn-cancel-mem"
                      onClick={() => setShowAddMemForm(false)}
                      disabled={isAddingMem}
                    >
                      取消
                    </button>
                  </div>
                </form>
              )}

              {/* 記憶卡片網格 */}
              {loadingMemories ? (
                <div className="memories-loading">大腦記憶中心檢索中...</div>
              ) : projectMemories.length > 0 ? (
                <div className="memories-cards-grid">
                  {projectMemories.map((mem) => (
                    <div key={mem.id} className={`memory-card type-${mem.type}`}>
                      <div className="mem-card-top">
                        <span className="mem-type-pill">
                          {mem.type === "campus_context"
                            ? "🏫 校園地標"
                            : mem.type === "audience"
                            ? "👥 新生洞察"
                            : mem.type === "insight"
                            ? "✨ 核心價值"
                            : "🎨 視覺規範"}
                        </span>
                        <button
                          type="button"
                          className="btn-inject-mem"
                          onClick={() => handleInjectMemoryToPrompt(mem)}
                          title="點擊將此記憶脈絡注入到提示詞中"
                        >
                          ➕ 注入 Prompt
                        </button>
                      </div>
                      <h5 className="mem-title">{mem.title}</h5>
                      <p className="mem-content">{mem.content}</p>
                      <div className="mem-tags-row">
                        {mem.tags.map((tag, i) => (
                          <span key={i} className="mem-tag">#{tag}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-memories">此專案目前尚無在地記憶，點擊上方按鈕新增第一筆！</div>
              )}
            </div>
          )}
        </div>

        {/* 生態系整合真實狀態列 (Truthful Integration Health) */}
        {integrations.length > 0 && (
          <details className="os-integration-status-row">
            <summary className="integration-label">🔌 生態系狀態</summary>
            <div className="integration-chips-wrap">
              {integrations.map((item) => (
                <div
                  key={item.id}
                  className={`integration-pill status-${item.status.toLowerCase().replace(/\s+/g, "-")}`}
                  title={`${item.name} (${item.status}) - ${item.details}`}
                >
                  <span className="integration-dot" />
                  <span className="integration-name">{item.name}</span>
                  <span className="integration-badge">{item.statusBadge}</span>
                  {item.latencyMs > 0 && <span className="integration-latency">{item.latencyMs}ms</span>}
                </div>
              ))}
            </div>
          </details>
        )}
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
              <span className="stage-label">
                {orchestratedTask?.domainMeta?.stage2Label || "校園 MCP 調用"}
              </span>
              <span className="stage-meta">
                {orchestratedTask?.domainMeta?.stage2Meta || "第 2 週迎新時程"}
              </span>
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

          {/* 9 大子任務編排時序與來源出處 (Subtasks Orchestration & Provenance) */}
          {orchestratedTask && (
            <div className="subtasks-orchestration-container">
              <div className="subtasks-toggle-bar">
                <div className="subtasks-toggle-title">
                  <span className="subtasks-icon">⚡</span>
                  <strong>9 大子任務編排與來源出處追蹤 (Task Provenance)</strong>
                  <span className="subtasks-meta">
                    總耗時 {orchestratedTask.totalDurationMs}ms・{orchestratedTask.subtasks.length} 階全自動協同
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-toggle-subtasks"
                  onClick={() => setShowSubtasks(!showSubtasks)}
                >
                  {showSubtasks ? "收合子任務明細 ▲" : "展開 9 大子任務明細 ▼"}
                </button>
              </div>

              {showSubtasks && (
                <div className="subtasks-grid">
                  {orchestratedTask.subtasks.map((st, idx) => (
                    <div key={st.subtaskId} className="subtask-card">
                      <div className="subtask-card-header">
                        <span className="subtask-idx">Step {idx + 1}</span>
                        <span className="subtask-title">{st.title}</span>
                        <span className="subtask-duration">{st.durationMs}ms</span>
                        <span className={`subtask-status-badge status-${st.status}`}>
                          {st.status === "completed" ? "✓ 完成" : st.status}
                        </span>
                      </div>
                      <p className="subtask-desc">{st.description}</p>

                      {st.outputSummary && (
                        <div className="subtask-summary">
                          <strong>產出：</strong>{st.outputSummary}
                        </div>
                      )}

                      <div className="subtask-provenance">
                        <div className="prov-row">
                          <span className="prov-label">來源出處：</span>
                          <code className="prov-source">{st.provenance.sourceOrigin}</code>
                        </div>
                        {st.provenance.rightsOrAttribution && (
                          <div className="prov-row">
                            <span className="prov-label">權限/歸屬：</span>
                            <span className="prov-rights">{st.provenance.rightsOrAttribution}</span>
                          </div>
                        )}
                      </div>

                      {st.evidenceVsHypothesis && (
                        <div className="subtask-eh-box">
                          {st.evidenceVsHypothesis.evidence.length > 0 && (
                            <div className="eh-subrow">
                              <span className="eh-mini-tag verified">證據</span>
                              <span className="eh-mini-text">
                                {st.evidenceVsHypothesis.evidence.join("；")}
                              </span>
                            </div>
                          )}
                          {st.evidenceVsHypothesis.hypotheses.length > 0 && (
                            <div className="eh-subrow">
                              <span className="eh-mini-tag hypothesis">假設</span>
                              <span className="eh-mini-text">
                                {st.evidenceVsHypothesis.hypotheses.join("；")}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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
                  onClick={() => {
                    setActiveDirIndex(idx);
                    setCanvaExportResult(null);
                  }}
                >
                  <span className="dir-tab-rank">#{idx + 1}</span>
                  <span className="dir-tab-name">{dir.title}</span>
                  <span className="dir-tab-score">{dir.audienceScores.overallScore} 分</span>
                </button>
              ))}
            </div>
          </div>

          <nav className="mobile-pane-tabs" aria-label="手機工作區分頁">
            {MOBILE_CREATIVE_PANES.map((pane) => (
              <button
                key={pane.id}
                type="button"
                className={`mobile-pane-tab ${mobilePane === pane.id ? "active" : ""}`}
                onClick={() => setMobilePane(pane.id)}
              >
                {pane.label}
              </button>
            ))}
          </nav>

          {/* 核心內容雙欄佈局 */}
          <div className="direction-content-grid">
            {/* 左欄：方向詳情、Canva 設計藍圖、IG 文案 */}
            <div className="grid-left-col">
              {/* 方向核心卡片 */}
              <div className={`os-card dir-overview-card mobile-pane ${mobilePane === "brief" ? "is-active" : ""}`}>
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

              {/* Canva 設計草稿分層藍圖與微縮畫布 */}
              <div className={`os-card canva-blueprint-card mobile-pane ${mobilePane === "design" ? "is-active" : ""}`}>
                <div className="card-title-row">
                  <div className="title-left-group">
                    <span className="card-icon">📐</span>
                    <div>
                      <h4>Canva 設計草稿分層藍圖</h4>
                      <span className="card-sub-desc">1080x1350 規格 (4:5 直式滿版) 與 36px 手作三色光邊角印章規範</span>
                    </div>
                  </div>
                  <div className="title-badge-group">
                    <span className="ratio-tag">{currentDirection.canvaBlueprint.dimensions} (4:5)</span>
                    <span className="provenance-tag">
                      {currentDirection.canvaBlueprint.created ? "⚡ 已連線官方 API" : "📁 本機沙盒藍圖 (created: false)"}
                    </span>
                  </div>
                </div>

                {/* 誠實出處告示 */}
                <div className="blueprint-truth-notice">
                  <span className="notice-icon">ℹ️</span>
                  <span>
                    未連線 Canva 官方付費 API 憑證，系統以高擬真 1080×1350 規格進行本地結構生成與預覽，絕不偽造在線存取。
                  </span>
                </div>

                <div className="blueprint-workspace-grid">
                  {/* 左欄：4:5 直式畫布微縮預覽 */}
                  <div className="mockup-column">
                    <div className="mockup-header-label">
                      <span>畫布微縮預覽 (4:5)</span>
                      <span className="mockup-dim">1080 × 1350</span>
                    </div>
                    <div
                      className="blueprint-canvas-preview"
                      style={{
                        background: `linear-gradient(155deg, ${currentDirection.colorPalette[0]?.hex || "#1e293b"} 0%, ${currentDirection.colorPalette[1]?.hex || "#0f172a"} 100%)`
                      }}
                    >
                      <div className="canvas-ambient-glow" />
                      <div className="canvas-content-wrapper">
                        <div className="canvas-top-badge">
                          {currentDirection.canvaBlueprint.layers.find((l) => l.layer === 2)?.content || currentDirection.title}
                        </div>
                        <div className="canvas-headline">
                          {currentDirection.canvaBlueprint.layers.find((l) => l.layer === 3)?.content || currentDirection.title}
                        </div>
                        <div className="canvas-subtitle">
                          {currentDirection.canvaBlueprint.layers.find((l) => l.layer === 4)?.content || "克難坡茶席 | 12:15-13:00"}
                        </div>
                        <div className="canvas-cta-pill">
                          {currentDirection.canvaBlueprint.layers.find((l) => l.layer === 5)?.content || "🍵 立即卡位領茶"}
                        </div>
                      </div>

                      {/* 手作三色光邊角印章 (36px 圓形道具規範：紅外圈、黃中圈、綠中心) */}
                      <div className="mockup-craft-stamp" title="36px 手作圓形三色光邊角印章 (非標靶/非紅綠燈)">
                        <div className="stamp-ring-red">
                          <div className="stamp-ring-yellow">
                            <div className="stamp-core-green" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 右欄：分層結構與匯出控制器 */}
                  <div className="layers-controller-column">
                    <div className="layers-header-label">分層圖層定義 (Layers)</div>
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

                    {/* Canva 草稿匯出控制器 */}
                    <div className="canva-export-controller">
                      <div className="export-controller-title">
                        <span>📥 Canva 草稿規格匯出</span>
                        <div className="format-picker">
                          {(["png", "jpg", "pdf"] as const).map((fmt) => (
                            <button
                              key={fmt}
                              type="button"
                              className={`format-chip ${exportFormat === fmt ? "is-selected" : ""}`}
                              onClick={() => setExportFormat(fmt)}
                            >
                              {fmt.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="blueprint-actions">
                        <button
                          type="button"
                          className="btn-trigger-export"
                          onClick={handleExportCanvaDraft}
                          disabled={isExportingCanva}
                        >
                          {isExportingCanva ? "匯出規格產出中..." : `📥 產生 ${exportFormat.toUpperCase()} 規格`}
                        </button>
                        <a
                          href={currentDirection.canvaBlueprint.exportDraftUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-open-canva"
                        >
                          在新分頁開啟草稿 ↗
                        </a>
                        <button
                          type="button"
                          className="btn-copy-blueprint"
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(currentDirection.canvaBlueprint, null, 2));
                            showToast("Canva 藍圖 JSON 已複製至剪貼簿！");
                          }}
                        >
                          複製藍圖 JSON
                        </button>
                      </div>

                      {/* 匯出結果橫幅 */}
                      {canvaExportResult && (
                        <div className="canva-export-result-panel">
                          <div className="export-result-header">
                            <div className="export-result-title">
                              <span className="export-check-icon">✓</span>
                              <strong>{canvaExportResult.format?.toUpperCase()} 草稿規格產出成功</strong>
                            </div>
                            <span className="export-mode-tag">
                              {canvaExportResult.mode === "live_connected" ? "⚡ 官方 API 連線" : "📁 沙盒藍圖 (1080x1350)"}
                            </span>
                          </div>
                          <div className="export-result-details">
                            <div className="detail-item">
                              <span className="detail-k">作業編號：</span>
                              <span className="detail-v font-mono">{canvaExportResult.jobId || canvaExportResult.draftId}</span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-k">預覽尺寸：</span>
                              <span className="detail-v">{canvaExportResult.previewDimensions || "1080x1350"}</span>
                            </div>
                          </div>
                          <p className="export-result-msg">{canvaExportResult.message}</p>
                          <div className="export-result-actions">
                            {canvaExportResult.exportUrl && (
                              <a
                                href={canvaExportResult.exportUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="btn-preview-download"
                              >
                                開啟草稿預覽連結 ↗
                              </a>
                            )}
                            <button
                              type="button"
                              className="btn-dismiss-export"
                              onClick={() => setCanvaExportResult(null)}
                            >
                              ✕ 清除
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 草稿完成後受眾再測驗報告 (Audience Re-evaluation) */}
              {orchestratedTask?.draftReevaluations && (
                (() => {
                  const reeval = orchestratedTask.draftReevaluations.find(
                    (r) => r.directionId === currentDirection.id
                  ) || orchestratedTask.draftReevaluations[activeDirIndex];
                  if (!reeval) return null;

                  return (
                    <div className={`os-card reevaluation-card mobile-pane ${mobilePane === "design" ? "is-active" : ""}`}>
                      <div className="card-title-row">
                        <span className="card-icon">🔬</span>
                        <div>
                          <h4>草稿後受眾再測驗報告 (Post-Draft Re-evaluation)</h4>
                          <span className="card-sub-desc">5 位受眾針對 Canva 畫布圖層與動線之落地驗證</span>
                        </div>
                        <span className="reeval-verdict-tag">{reeval.verdict}</span>
                      </div>

                      <div className="reeval-scores-banner">
                        <div className="reeval-score-item">
                          <span className="reeval-label">概念階段初評</span>
                          <span className="reeval-val">{reeval.preDraftOverallScore} 分</span>
                        </div>
                        <div className="reeval-arrow">➔</div>
                        <div className="reeval-score-item highlight">
                          <span className="reeval-label">草稿落地後再測驗</span>
                          <span className="reeval-val">{reeval.postDraftOverallScore} 分</span>
                        </div>
                        <div className="reeval-delta-badge">
                          +{reeval.scoreDelta}% 視覺落地增益
                        </div>
                      </div>

                      <div className="layer-critiques-block">
                        <div className="critique-header">Canva 圖層受眾即時審驗：</div>
                        <div className="critique-list">
                          {reeval.layerCritiques.map((c, i) => (
                            <div key={i} className="critique-item">
                              <span className="critique-badge">L{c.layerIndex} {c.aspect}</span>
                              <span className="critique-reaction">「{c.personaReaction}」</span>
                              <span className="critique-status">{c.passed ? "✓ 通過" : "待調整"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()
              )}

              {/* Instagram 社群文案排版 */}
              <div className={`os-card ig-caption-card mobile-pane ${mobilePane === "copy" ? "is-active" : ""}`}>
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

                {/* IG 校園發布調研建議展開切換按鈕 */}
                {igReport && (
                  <div className="ig-research-toggle-row">
                    <button
                      type="button"
                      className="btn-toggle-ig-research"
                      onClick={() => setShowIgResearch(!showIgResearch)}
                    >
                      {showIgResearch
                        ? "收合校園社群調研與發布時機建議 ▲"
                        : "📊 展開 Instagram 校園調研與最佳發布時段建議 ▼"}
                    </button>
                  </div>
                )}

                {/* 展開之 IG 社群調研面板 */}
                {showIgResearch && igReport && (
                  <div className="ig-research-expanded-box">
                    {/* 即時發布契合度條 */}
                    <div className="readiness-banner">
                      <div className="readiness-header">
                        <span className="readiness-title">
                          ⚡ 即時發布契合度指數：<strong>{igReport.currentPostingReadiness.score} / 100</strong>
                        </span>
                        <span
                          className={`readiness-pill ${
                            igReport.currentPostingReadiness.isGoldenHourNow ? "golden" : "normal"
                          }`}
                        >
                          {igReport.currentPostingReadiness.isGoldenHourNow
                            ? "⭐ 目前正值黃金發布檔期"
                            : igReport.currentPostingReadiness.currentSlot || "一般時段"}
                        </span>
                      </div>
                      <p className="readiness-tip">{igReport.currentPostingReadiness.advice}</p>
                    </div>

                    {/* 3 大校園生活作息時段 */}
                    <div className="posting-schedule-section">
                      <div className="section-subtitle">🕒 校園作息最佳發布時段模型：</div>
                      <div className="posting-slots-grid">
                        {igReport.optimalPostingTimes.map((slot) => (
                          <div
                            key={slot.timeRange}
                            className={`slot-card ${slot.isPrimeGoldenHour ? "golden-slot" : ""}`}
                          >
                            <div className="slot-title-row">
                              <strong>{slot.name}</strong>
                              <span className="slot-weight">權重 {slot.reachWeight}</span>
                            </div>
                            <div className="slot-time">{slot.timeRange}</div>
                            <div className="slot-retention">
                              停留：{slot.dwellTimeSec}s · 格式：
                              {slot.formatRecommendation === "feed_portrait_4_5"
                                ? "4:5 滿版 Feed"
                                : slot.formatRecommendation === "story_9_16"
                                ? "9:16 限動"
                                : slot.formatRecommendation === "carousel"
                                ? "輪播貼文"
                                : "Threads 純文字"}
                            </div>
                            <p className="slot-rec">{slot.notes}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 4:5 視覺規範與手作三色光道具邊角印章 */}
                    <div className="visual-guidelines-box">
                      <div className="section-subtitle">📐 視覺規格與三色光道具規範：</div>
                      <div className="specs-list">
                        <div>
                          • 推薦比例：<strong>{igReport.visualGuidelines.recommendedAspectRatio}</strong> (
                          {igReport.visualGuidelines.dimensions.width}x{igReport.visualGuidelines.dimensions.height} px)
                        </div>
                        <div>
                          • 安全邊界：頂部安全區 {igReport.visualGuidelines.safeZones.top}px、底部安全區{" "}
                          {igReport.visualGuidelines.safeZones.bottom}px
                        </div>
                        <div>
                          • 首屏折疊：前 {igReport.visualGuidelines.hookFoldLineChars} 字元為折疊前核心鉤子
                        </div>
                        <div className="craft-stamp-rule">• {igReport.visualGuidelines.craftStampRule}</div>
                      </div>
                    </div>

                    <div className="ig-research-disclaimer">
                      <span>🛡️ {igReport.truthStatus.message} · {igReport.disclaimer}</span>
                    </div>
                  </div>
                )}

                <div className="caption-publish-row">
                  <button className="btn-trigger-publish" onClick={handleOpenPublishModal}>
                    🛡️ 審核並發布此文宣 (需二次確認)
                  </button>
                  <span className="publish-hint">安全機制：受限於 Publish 權限階層，防止未經審核的意外推播</span>
                </div>

                {/* 發布審核通過紀錄卡片 (Audit Trail) */}
                {publishResult && (
                  <div className="publish-audit-trail-box">
                    <div className="audit-header-row">
                      <span className="audit-badge">
                        {publishResult.mode === "sandbox_simulation"
                          ? "🛡️ 安全沙盒審核完成 (Sandbox Audit Trail)"
                          : "🚀 已正式提交發布"}
                      </span>
                      <button
                        type="button"
                        className="btn-clear-audit"
                        onClick={() => setPublishResult(null)}
                        title="清除發布紀錄"
                      >
                        ✕ 清除紀錄
                      </button>
                    </div>
                    <div className="audit-details-grid">
                      <div className="audit-detail-item">
                        <span className="audit-label">狀態：</span>
                        <span className="audit-val">{publishResult.status}</span>
                      </div>
                      <div className="audit-detail-item">
                        <span className="audit-label">目標平台：</span>
                        <span className="audit-val">{publishResult.platform}</span>
                      </div>
                      <div className="audit-detail-item">
                        <span className="audit-label">防重複冪等鍵：</span>
                        <code className="audit-code">{publishResult.idempotencyKey}</code>
                      </div>
                      <div className="audit-detail-item">
                        <span className="audit-label">審核時間：</span>
                        <span className="audit-val">
                          {publishResult.auditTrail?.timestamp
                            ? new Date(publishResult.auditTrail.timestamp).toLocaleTimeString()
                            : new Date().toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                    <p className="audit-disclaimer">
                      {publishResult.auditTrail?.disclaimer || publishResult.note}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* 右欄：Audience Twin 5 大 Persona 反饋與雷達評分 */}
            <div className={`grid-right-col mobile-pane ${mobilePane === "audience" ? "is-active" : ""}`}>
              <div className="os-card audience-twin-card">
                <div className="card-title-row">
                  <span className="card-icon">👥</span>
                  <div>
                    <h4>Audience Twin 受眾雙生模擬</h4>
                    <span className="card-sub-desc">5 位模擬角色即時評判與辯論共識</span>
                  </div>
                </div>

                {/* 3 大視角頁籤切換：辯論評估 vs 逆向思考與滑掉風險 vs 5 大 PersonaProfile 畫像 */}
                <div className="audience-subnav-tabs">
                  <button
                    type="button"
                    className={`audience-subnav-btn ${audienceTab === "feedback" ? "active" : ""}`}
                    onClick={() => setAudienceTab("feedback")}
                  >
                    💬 辯論評估與回饋
                  </button>
                  <button
                    type="button"
                    className={`audience-subnav-btn ${audienceTab === "reverse" ? "active" : ""}`}
                    onClick={() => {
                      setAudienceTab("reverse");
                      if (currentDirection && !reverseThinkingMap[currentDirection.id]) {
                        fetchReverseThinking(currentDirection);
                      }
                    }}
                  >
                    🔄 逆向思考與滑掉風險
                  </button>
                  <button
                    type="button"
                    className={`audience-subnav-btn ${audienceTab === "personas" ? "active" : ""}`}
                    onClick={() => setAudienceTab("personas")}
                  >
                    👤 5 大受眾立體畫像 ({activePersonas.length || 5})
                  </button>
                </div>

                {audienceTab === "feedback" && (
                  <>
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
                  </>
                )}

                {audienceTab === "reverse" && (
                  <div className="audience-reverse-column">
                    <div className="reverse-truth-notice">
                      <span className="notice-icon">🛡️</span>
                      <div className="notice-content">
                        <div className="notice-title">console_fixture · AI 模擬啟發式評估（非真人受訪）</div>
                        <div className="notice-sub">
                          路人視角模擬為啟發式推論（Heuristic Simulation），不代表真實點擊率（CTR）或轉換率。
                        </div>
                      </div>
                    </div>

                    {loadingReverse ? (
                      <div className="personas-loading-state">正在模擬路人第一眼直覺與流失風險...</div>
                    ) : (() => {
                      const reverseData = currentDirection ? reverseThinkingMap[currentDirection.id] : null;
                      if (!reverseData) {
                        return (
                          <div className="empty-state">
                            <p>尚無逆向思考資料</p>
                            {currentDirection && (
                              <button
                                type="button"
                                className="btn-retry-reverse"
                                onClick={() => fetchReverseThinking(currentDirection)}
                              >
                                重新載入逆向分析
                              </button>
                            )}
                          </div>
                        );
                      }

                      return (
                        <>
                          {/* 滑掉風險橫幅 */}
                          <div className={`swipe-risk-banner risk-${reverseData.swipeRisk.label}`}>
                            <div className="risk-score-col">
                              <span className="risk-label">路人滑掉風險指標</span>
                              <div className="risk-score-wrap">
                                <span className="risk-score">{reverseData.swipeRisk.score}</span>
                                <span className="risk-score-denom">/ 100</span>
                              </div>
                            </div>
                            <div className="risk-info-col">
                              <span className="risk-level-badge">
                                {reverseData.swipeRisk.label === "high"
                                  ? "🚨 高風險 (易直接滑過)"
                                  : reverseData.swipeRisk.label === "medium"
                                  ? "⚠️ 中度流失風險"
                                  : "✓ 低流失風險 (停留意願高)"}
                              </span>
                              <p className="risk-desc">{reverseData.swipeRisk.note}</p>
                            </div>
                          </div>

                          {/* 5 位受眾的「路人第一眼」直覺檢視 */}
                          <div className="perspectives-list">
                            <div className="perspectives-header">
                              <span>5 位虛擬受眾「路人第一眼」直覺檢視 (Bystander First Glance)：</span>
                            </div>
                            {reverseData.perspectives.map((p) => (
                              <div key={p.personaId} className="perspective-card">
                                <div className="perspective-top">
                                  <div className="p-name-role">
                                    <strong>{p.name}</strong>
                                    <span className="p-persona-id">
                                      {p.personaId === "bystander" ? "路人視角 ⭐" : p.personaId}
                                    </span>
                                  </div>
                                  <span className={`swipe-status-tag ${p.wouldSwipeAway ? "swipe-away" : "stay"}`}>
                                    {p.wouldSwipeAway ? "🚨 容易直接滑掉" : "👀 願意停駐關注"}
                                  </span>
                                </div>
                                <p className="p-first-glance">「{p.firstGlance}」</p>
                                <div className="p-details-grid">
                                  <div className="p-detail-box negative">
                                    <span className="box-tag">滑掉主因</span>
                                    <span>{p.swipeReason}</span>
                                  </div>
                                  <div className="p-detail-box positive">
                                    <span className="box-tag">停駐關鍵</span>
                                    <span>{p.keepReason}</span>
                                  </div>
                                </div>
                                <div className="p-revision-ask">
                                  <strong>💡 受眾修改請求：</strong>{p.revisionAsk}
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* 抗性破除建議清單 */}
                          <div className="recommended-revisions-card">
                            <div className="rev-header">
                              <span>💡 受眾抗性破除與優化建議：</span>
                              <button
                                type="button"
                                className="btn-copy-revisions"
                                onClick={() => {
                                  navigator.clipboard.writeText(reverseData.recommendedRevisions.join("\n"));
                                  showToast("優化建議已複製至剪貼簿！");
                                }}
                              >
                                複製建議
                              </button>
                            </div>
                            <ul className="revisions-bullet-list">
                              {reverseData.recommendedRevisions.map((rev, i) => (
                                <li key={i}>{rev}</li>
                              ))}
                            </ul>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {audienceTab === "personas" && (
                  <div className="audience-personas-column">
                    <div className="personas-view-header">
                      <span className="personas-view-subtitle">
                        🎯 當前適配脈絡：
                        {currentDirection.audienceFeedback.domain === "ntu"
                          ? "🚲 臺灣大學"
                          : currentDirection.audienceFeedback.domain === "general"
                          ? "🎓 通用大專"
                          : "🏫 淡江大學"}
                        {" · "}5 位立體受眾設定
                      </span>
                    </div>
                    {loadingPersonas ? (
                      <div className="personas-loading-state">載入受眾雙生畫像中...</div>
                    ) : activePersonas.length > 0 ? (
                      <div className="personas-cards-list">
                        {activePersonas.map((p) => (
                          <PersonaCard key={p.id} persona={p} />
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state">
                        <p>尚未載入受眾畫像資料</p>
                      </div>
                    )}
                  </div>
                )}
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
