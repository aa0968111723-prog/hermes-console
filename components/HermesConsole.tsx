"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PROJECTS, TOOLS, Project } from "@/lib/catalog";
import { HERMES_DEFAULTS, STORAGE_KEYS, normalizeBaseUrl } from "@/lib/hermes-config";
import { HERMES_TOOLS, ToolExecutionResult, executeHermesTool } from "@/lib/tools";
import JieWorld from "./JieWorld";

export type ToolCallData = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "calling" | "done" | "error";
  result?: unknown;
};

export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
  thought?: string;
  toolCalls?: ToolCallData[];
  timestamp?: number;
};

export type Conversation = {
  id: string;
  title: string;
  activeProject: string;
  messages: Message[];
  updatedAt: number;
};

export default function HermesConsole() {
  // 檢視模式：指揮中樞 (console) 或 倢小天地 (jieworld)
  const [viewMode, setViewMode] = useState<"console" | "jieworld">("console");

  // 大腦引擎模式：'auto' (自動雲端+本地備援) | 'cloud' (強制 Zeabur) | 'local' (本地沙盒大腦)
  const [engineMode, setEngineMode] = useState<"auto" | "cloud" | "local">("auto");

  // Zeabur 連線狀態
  const [apiUrl, setApiUrl] = useState("https://hermes-agent-api.zeabur.app");
  const [apiKey, setApiKey] = useState(HERMES_DEFAULTS.DEFAULT_API_KEY);
  const [pingLatency, setPingLatency] = useState<number | null>(null);
  const [pingStatus, setPingStatus] = useState<"idle" | "testing" | "online" | "offline">("idle");
  const [pingError, setPingError] = useState("");

  // 對話管理
  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: "conv-1",
      title: "Hermes 大腦指揮艙",
      activeProject: "hermes-console",
      updatedAt: Date.now(),
      messages: [
        {
          role: "assistant",
          content: "你好，我是柯能的中央大腦 Hermes Agent。已在 Zeabur 部署就緒，並深度連接 41 個生態系專案與全套工具箱。你可以隨時請我檢索專案、切分鏡、查詢 GitHub 或執行創作工作流！",
          timestamp: Date.now()
        }
      ]
    }
  ]);
  const [activeConvId, setActiveConvId] = useState("conv-1");
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusText, setStatusText] = useState("");

  // 介面抽屜與分頁
  const [activeTab, setActiveTab] = useState<"chat" | "projects" | "tools" | "settings">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectGroupFilter, setProjectGroupFilter] = useState("全部");
  const [copyNotification, setCopyNotification] = useState("");

  // 工具箱即時測試器狀態
  const [selectedToolForRunner, setSelectedToolForRunner] = useState("get_ecosystem_projects");
  const [toolRunnerArgs, setToolRunnerArgs] = useState(JSON.stringify({ query: "設計", group: "" }, null, 2));
  const [toolRunnerResult, setToolRunnerResult] = useState<ToolExecutionResult | null>(null);
  const [toolRunnerBusy, setToolRunnerBusy] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 初始化載入 LocalStorage
  useEffect(() => {
    const savedUrl = localStorage.getItem(STORAGE_KEYS.API_URL) || "https://hermes-agent-api.zeabur.app";
    const savedKey = localStorage.getItem(STORAGE_KEYS.API_KEY) || HERMES_DEFAULTS.DEFAULT_API_KEY;
    const savedMode = (localStorage.getItem(STORAGE_KEYS.VIEW_MODE) as "console" | "jieworld") || "console";
    
    setApiUrl(savedUrl);
    setApiKey(savedKey);
    setViewMode(savedMode);

    try {
      const savedConvs = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
      if (savedConvs) {
        const parsed = JSON.parse(savedConvs);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setConversations(parsed);
          const savedActiveId = localStorage.getItem(STORAGE_KEYS.ACTIVE_CONV_ID);
          if (savedActiveId && parsed.some(c => c.id === savedActiveId)) {
            setActiveConvId(savedActiveId);
          } else {
            setActiveConvId(parsed[0].id);
          }
        }
      }
    } catch {}

    testZeaburConnection(savedUrl, savedKey);
  }, []);

  // 保存對話記錄
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations));
      localStorage.setItem(STORAGE_KEYS.ACTIVE_CONV_ID, activeConvId);
    } catch {}
  }, [conversations, activeConvId]);

  // 自動捲動至底
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [conversations, activeConvId, isGenerating, statusText]);

  const currentConv = useMemo(() => {
    return conversations.find((c) => c.id === activeConvId) || conversations[0];
  }, [conversations, activeConvId]);

  // 測試與 Zeabur Hermes 連線
  async function testZeaburConnection(urlToTest?: string, keyToTest?: string) {
    const targetUrl = urlToTest ?? apiUrl;
    const targetKey = keyToTest ?? apiKey;
    if (!targetUrl.trim()) {
      setPingStatus("offline");
      setPingError("請填入 Zeabur 綁定的 API 網域");
      return;
    }

    setPingStatus("testing");
    setPingError("");
    try {
      const res = await fetch("/api/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: targetUrl, apiKey: targetKey })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPingStatus("online");
        setPingLatency(data.latencyMs);
        setPingError("");
      } else {
        setPingStatus("offline");
        setPingError(data.error || "連線未回應");
      }
    } catch (e: unknown) {
      setPingStatus("offline");
      setPingError(e instanceof Error ? e.message : "連線測試失敗");
    }
  }

  // 儲存連線設定
  function handleSaveSettings() {
    const cleanUrl = normalizeBaseUrl(apiUrl);
    const cleanKey = apiKey.trim() || HERMES_DEFAULTS.DEFAULT_API_KEY;
    localStorage.setItem(STORAGE_KEYS.API_URL, cleanUrl);
    localStorage.setItem(STORAGE_KEYS.API_KEY, cleanKey);
    setApiUrl(cleanUrl);
    setApiKey(cleanKey);
    testZeaburConnection(cleanUrl, cleanKey);
    showNotice("連線設定已成功儲存！");
    setActiveTab("chat");
  }

  function showNotice(msg: string) {
    setCopyNotification(msg);
    setTimeout(() => setCopyNotification(""), 3000);
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text);
    showNotice(`已複製 ${label}`);
  }

  // 建立新對話
  function handleNewConversation(project = "hermes-console") {
    const newId = `conv-${Date.now()}`;
    const newConv: Conversation = {
      id: newId,
      title: "新對話任務",
      activeProject: project,
      updatedAt: Date.now(),
      messages: [
        {
          role: "assistant",
          content: `已開啟新對話。當前專案上下文鎖定為 [${project}]。你可以請我檢索程式碼、規劃分鏡或調用工具。`,
          timestamp: Date.now()
        }
      ]
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveConvId(newId);
    setActiveTab("chat");
    setSidebarOpen(false);
  }

  // 刪除對話
  function handleDeleteConversation(id: string) {
    if (conversations.length <= 1) {
      handleNewConversation();
      return;
    }
    const nextConvs = conversations.filter((c) => c.id !== id);
    setConversations(nextConvs);
    if (activeConvId === id) {
      setActiveConvId(nextConvs[0].id);
    }
  }

  // 設定當前專案上下文
  function handleSelectProject(projectName: string) {
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConvId ? { ...c, activeProject: projectName } : c))
    );
    showNotice(`已將上下文切換至：${projectName}`);
  }

  // 解析 Hermes 回傳文字中的 <thought> 與 <tool_call>
  function parseHermesResponse(rawText: string): { thought?: string; cleanContent: string; inlineToolCall?: { name: string; args: Record<string, unknown> } } {
    let thought: string | undefined = undefined;
    let cleanContent = rawText;
    let inlineToolCall: { name: string; args: Record<string, unknown> } | undefined = undefined;

    // 解析 <thought>...</thought>
    const thoughtMatch = cleanContent.match(/<thought>([\s\S]*?)<\/thought>/i);
    if (thoughtMatch) {
      thought = thoughtMatch[1].trim();
      cleanContent = cleanContent.replace(/<thought>[\s\S]*?<\/thought>/i, "").trim();
    }

    // 解析 <tool_call>...</tool_call>
    const toolMatch = cleanContent.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
    if (toolMatch) {
      try {
        const parsed = JSON.parse(toolMatch[1].trim());
        if (parsed.name) {
          inlineToolCall = {
            name: parsed.name,
            args: parsed.arguments || parsed.args || {}
          };
          cleanContent = cleanContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/i, "").trim();
        }
      } catch {}
    }

    return { thought, cleanContent, inlineToolCall };
  }

  // 發送訊息給 Hermes Agent
  async function handleSendMessage(customPrompt?: string) {
    const text = (customPrompt ?? input).trim();
    if (!text || isGenerating) return;

    const userMessage: Message = {
      role: "user",
      content: text,
      timestamp: Date.now()
    };

    const nextMessages = [...currentConv.messages, userMessage];
    
    // 更新對話標題
    const isFirstUserMessage = currentConv.messages.filter((m) => m.role === "user").length === 0;
    const nextTitle = isFirstUserMessage ? text.slice(0, 18) : currentConv.title;

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConvId
          ? {
              ...c,
              title: nextTitle,
              updatedAt: Date.now(),
              messages: nextMessages
            }
          : c
      )
    );

    setInput("");
    setIsGenerating(true);
    setStatusText("Hermes 大腦正在思考與檢索工具...");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: apiUrl,
          apiKey,
          model: HERMES_DEFAULTS.DEFAULT_MODEL,
          activeProject: currentConv.activeProject,
          forceLocal: engineMode === "local",
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content
          }))
        })
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        const errorMessage: Message = {
          role: "assistant",
          content: `連線異常：${errData.error || res.statusText}`,
          timestamp: Date.now()
        };
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeConvId ? { ...c, messages: [...nextMessages, errorMessage] } : c
          )
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let rawAccumulated = "";
      let buffer = "";

      const assistantMsgIndex = nextMessages.length;
      let currentAssistantMessage: Message = {
        role: "assistant",
        content: "",
        timestamp: Date.now()
      };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId
            ? { ...c, messages: [...nextMessages, currentAssistantMessage] }
            : c
        )
      );

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.slice(5).trim();
          if (!dataStr || dataStr === "[DONE]") continue;

          try {
            const json = JSON.parse(dataStr);
            const delta = json.choices?.[0]?.delta;
            if (delta?.content) {
              rawAccumulated += delta.content;
            } else if (json.choices?.[0]?.message?.content) {
              rawAccumulated += json.choices[0].message.content;
            }

            const { thought, cleanContent, inlineToolCall } = parseHermesResponse(rawAccumulated);
            
            currentAssistantMessage = {
              ...currentAssistantMessage,
              thought,
              content: cleanContent || (thought ? "（正在思考中...）" : "…")
            };

            if (inlineToolCall && !currentAssistantMessage.toolCalls?.some(t => t.name === inlineToolCall.name)) {
              setStatusText(`正在調用工具：${inlineToolCall.name}...`);
              const toolItem: ToolCallData = {
                id: `tool-${Date.now()}`,
                name: inlineToolCall.name,
                args: inlineToolCall.args,
                status: "calling"
              };
              currentAssistantMessage.toolCalls = [toolItem];
              
              executeHermesTool(inlineToolCall.name, inlineToolCall.args).then((toolRes) => {
                setStatusText("工具執行完成，整合回覆...");
                setConversations((prev) =>
                  prev.map((c) => {
                    if (c.id !== activeConvId) return c;
                    const msgs = [...c.messages];
                    const target = msgs[assistantMsgIndex];
                    if (target && target.toolCalls) {
                      target.toolCalls = target.toolCalls.map((t) =>
                        t.name === toolRes.toolName
                          ? { ...t, status: toolRes.success ? "done" : "error", result: toolRes.result }
                          : t
                      );
                    }
                    return { ...c, messages: msgs };
                  })
                );
              });
            }

            setConversations((prev) =>
              prev.map((c) => {
                if (c.id !== activeConvId) return c;
                const msgs = [...c.messages];
                msgs[assistantMsgIndex] = currentAssistantMessage;
                return { ...c, messages: msgs };
              })
            );
          } catch {
            rawAccumulated += dataStr;
            currentAssistantMessage.content = rawAccumulated;
            setConversations((prev) =>
              prev.map((c) => {
                if (c.id !== activeConvId) return c;
                const msgs = [...c.messages];
                msgs[assistantMsgIndex] = currentAssistantMessage;
                return { ...c, messages: msgs };
              })
            );
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  {
                    role: "assistant",
                    content: `連線異常：${msg}。已啟動本機大腦防護。`,
                    timestamp: Date.now()
                  }
                ]
              }
            : c
        )
      );
    } finally {
      setIsGenerating(false);
      setStatusText("");
    }
  }

  // 手動調用工具箱測試
  async function handleRunToolTester() {
    setToolRunnerBusy(true);
    setToolRunnerResult(null);
    try {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(toolRunnerArgs);
      } catch {
        parsedArgs = {};
      }
      const res = await executeHermesTool(selectedToolForRunner, parsedArgs);
      setToolRunnerResult(res);
    } catch (e: unknown) {
      setToolRunnerResult({
        toolName: selectedToolForRunner,
        args: {},
        success: false,
        result: { error: e instanceof Error ? e.message : String(e) },
        summary: "執行發生例外錯誤"
      });
    } finally {
      setToolRunnerBusy(false);
    }
  }

  // 專案過濾群組
  const filteredProjects = useMemo(() => {
    return PROJECTS.filter((p) => {
      const matchGroup = projectGroupFilter === "全部" || p.group === projectGroupFilter;
      const matchSearch =
        !projectSearch ||
        p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
        p.blurb.toLowerCase().includes(projectSearch.toLowerCase()) ||
        (p.tags && p.tags.some((t) => t.toLowerCase().includes(projectSearch.toLowerCase())));
      return matchGroup && matchSearch;
    });
  }, [projectSearch, projectGroupFilter]);

  const allGroups = ["全部", "控制台", "創作系統", "設計", "學校社團", "代理", "作品集"];

  // 若使用者切換到「倢小天地」粉彩靈感模式
  if (viewMode === "jieworld") {
    return (
      <div className="jieworld-wrapper">
        <div className="mode-bar">
          <span>🌸 倢的創作小天地</span>
          <button className="btn-mode-toggle" onClick={() => { setViewMode("console"); localStorage.setItem(STORAGE_KEYS.VIEW_MODE, "console"); }}>
            切換至 Hermes 指揮中樞 ⚡
          </button>
        </div>
        <JieWorld />
      </div>
    );
  }

  return (
    <div className="console-app">
      {/* 頂部通知提示 */}
      {copyNotification && <div className="toast-notification">{copyNotification}</div>}

      {/* 頂部導航列 (Surface: Operate & Command) */}
      <header className="console-header">
        <div className="brand-group">
          <button className="btn-menu-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="切換側邊欄">
            <span className="menu-icon">☰</span>
          </button>
          <div className="brand-info">
            <h1 className="brand-title">HERMES CONSOLE</h1>
            <span className="brand-badge">柯能中央大腦</span>
          </div>
        </div>

        <div className="header-status">
          {/* 大腦引擎切換器 */}
          <div className="engine-mode-pill">
            <span className="pill-label">大腦引擎：</span>
            <select
              className="engine-select"
              value={engineMode}
              onChange={(e) => setEngineMode(e.target.value as any)}
              title="選擇大腦運作模式"
            >
              <option value="auto">⚡ 自動備援 (雲端+本地)</option>
              <option value="cloud">☁️ Zeabur 雲端直連</option>
              <option value="local">💻 本地沙盒大腦</option>
            </select>
          </div>

          <div
            className={`status-pill ${pingStatus}`}
            onClick={() => setActiveTab("settings")}
            title="點擊檢查 Zeabur 連線與儀表板資訊"
          >
            <span className="status-dot" />
            <span className="status-text">
              {pingStatus === "online" && `Zeabur 在線 (${pingLatency}ms)`}
              {pingStatus === "testing" && "連線檢測中..."}
              {pingStatus === "offline" && "Zeabur 離線 / 待綁定"}
              {pingStatus === "idle" && "待檢測"}
            </span>
          </div>

          <div className="active-project-pill">
            <span className="pill-label">專案：</span>
            <span className="pill-val">{currentConv.activeProject}</span>
          </div>
        </div>

        <div className="header-actions">
          <button
            className="btn-atelier-switch"
            onClick={() => { setViewMode("jieworld"); localStorage.setItem(STORAGE_KEYS.VIEW_MODE, "jieworld"); }}
            title="切換至倢小天地靈感模式"
          >
            🌸 小天地
          </button>
          <button className="btn-primary-action" onClick={() => handleNewConversation(currentConv.activeProject)}>
            + 新對話
          </button>
        </div>
      </header>

      {/* 工作區本體 */}
      <div className="console-body">
        {/* 左側邊欄 (對話紀錄、專案上下文、工具快捷) */}
        <aside className={`console-sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="sidebar-section">
            <div className="section-header">
              <span className="section-title">對話歷史</span>
              <button className="btn-sm" onClick={() => handleNewConversation(currentConv.activeProject)} title="開新對話">+</button>
            </div>
            <div className="conversation-list">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`conv-item ${conv.id === activeConvId ? "active" : ""}`}
                  onClick={() => { setActiveConvId(conv.id); setActiveTab("chat"); setSidebarOpen(false); }}
                >
                  <span className="conv-icon">💬</span>
                  <div className="conv-text">
                    <div className="conv-title">{conv.title}</div>
                    <div className="conv-sub">{conv.activeProject} · {conv.messages.length} 則</div>
                  </div>
                  {conversations.length > 1 && (
                    <button
                      className="btn-conv-del"
                      onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                      title="刪除對話"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <div className="section-header">
              <span className="section-title">核心專案上下文</span>
              <span className="badge-count">41</span>
            </div>
            <div className="project-chips">
              {["hermes-console", "ai_os", "duigao", "planform-iso", "healing-studio", "tku-zen-agent"].map((p) => (
                <button
                  key={p}
                  className={`chip-btn ${currentConv.activeProject === p ? "selected" : ""}`}
                  onClick={() => handleSelectProject(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <div className="section-header">
              <span className="section-title">工具快捷調用</span>
            </div>
            <div className="quick-tool-triggers">
              <button className="quick-tool-btn" onClick={() => handleSendMessage("查詢當前專案規格與職責架構")}>
                🔍 專案規格深探
              </button>
              <button className="quick-tool-btn" onClick={() => handleSendMessage("檢索柯能 41 個生態系專案清單")}>
                📊 41 專案目錄
              </button>
              <button className="quick-tool-btn" onClick={() => handleSendMessage("為當前專案產出 16:9 分鏡鏡頭排程規格")}>
                🎬 生成分鏡規格
              </button>
              <button className="quick-tool-btn" onClick={() => handleSendMessage("檢查 Zeabur Hermes 大腦健康狀態")}>
                ⚡ 大腦健康診斷
              </button>
            </div>
          </div>

          <div className="sidebar-footer">
            <div className="nav-tabs">
              <button className={`nav-tab-btn ${activeTab === "chat" ? "active" : ""}`} onClick={() => setActiveTab("chat")}>
                主聊天
              </button>
              <button className={`nav-tab-btn ${activeTab === "projects" ? "active" : ""}`} onClick={() => setActiveTab("projects")}>
                專案目錄
              </button>
              <button className={`nav-tab-btn ${activeTab === "tools" ? "active" : ""}`} onClick={() => setActiveTab("tools")}>
                工具箱
              </button>
              <button className={`nav-tab-btn ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>
                Zeabur 連線
              </button>
            </div>
          </div>
        </aside>

        {/* 中央主視圖 */}
        <main className="console-main">
          {/* TAB 1: 主對話 (Operate Surface) */}
          {activeTab === "chat" && (
            <div className="chat-container">
              <div className="chat-messages" ref={chatScrollRef}>
                {currentConv.messages.length === 0 ? (
                  <div className="chat-empty-state">
                    <div className="empty-logo">⚡</div>
                    <h2>Hermes Agent 大腦控制台</h2>
                    <p className="empty-sub">
                      已連接 Zeabur 容器與 41 個生態系專案。輸入問題或點擊快捷指令：
                    </p>
                    <div className="quick-starters-grid">
                      <button className="starter-card" onClick={() => handleSendMessage("幫我檢索 41 個專案中所有與「設計」相關的專案與技術")}>
                        <div className="starter-title">🔍 檢索生態系專案</div>
                        <div className="starter-desc">調用 get_ecosystem_projects 工具查詢</div>
                      </button>
                      <button className="starter-card" onClick={() => handleSendMessage("檢查目前 Hermes Agent 運行狀態與 Zeabur 儀表板連接資訊")}>
                        <div className="starter-title">⚡ 檢查大腦與 Zeabur 狀態</div>
                        <div className="starter-desc">調用 check_hermes_status 檢查健康度</div>
                      </button>
                      <button className="starter-card" onClick={() => handleSendMessage("請為《淡大劇本》開場生成 4 個鏡頭的分鏡腳本與景別運鏡規劃")}>
                        <div className="starter-title">🎬 劇本分鏡鏡頭拆解</div>
                        <div className="starter-desc">調用 generate_creative_brief 產出分鏡</div>
                      </button>
                      <button className="starter-card" onClick={() => handleSendMessage("查詢當前專案 hermes-console 的詳細規格與角色職責")}>
                        <div className="starter-title">🛠️ 查詢專案規格與職責</div>
                        <div className="starter-desc">調用 inspect_project 取得架構地圖</div>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="messages-stream">
                    {currentConv.messages.map((msg, idx) => (
                      <div key={idx} className={`message-row ${msg.role}`}>
                        <div className="message-avatar">
                          {msg.role === "assistant" ? "⚡" : "👤"}
                        </div>
                        <div className="message-bubble-wrap">
                          <div className="message-meta">
                            <span className="role-name">{msg.role === "assistant" ? "Hermes Brain" : "Bruce"}</span>
                            {msg.timestamp && (
                              <span className="msg-time">
                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </div>

                          {/* 思維鏈展開卡片 */}
                          {msg.thought && (
                            <details className="thought-disclosure" open>
                              <summary className="thought-summary">
                                <span className="thought-icon">🧠</span>
                                <span>Hermes 思考推導過程 (CoT)</span>
                              </summary>
                              <div className="thought-content">{msg.thought}</div>
                            </details>
                          )}

                          {/* 工具調用卡片 */}
                          {msg.toolCalls && msg.toolCalls.length > 0 && (
                            <div className="tool-calls-container">
                              {msg.toolCalls.map((tc) => (
                                <div key={tc.id} className={`tool-call-card ${tc.status}`}>
                                  <div className="tool-call-header">
                                    <span className="tool-badge">🔧 TOOL</span>
                                    <span className="tool-name">{tc.name}</span>
                                    <span className="tool-status-text">
                                      {tc.status === "calling" && "執行中..."}
                                      {tc.status === "done" && "執行成功 ✓"}
                                      {tc.status === "error" && "調用失敗 ✗"}
                                    </span>
                                  </div>
                                  <details className="tool-details">
                                    <summary>調用參數與結果</summary>
                                    <pre className="tool-json">
                                      {JSON.stringify({ args: tc.args, result: tc.result }, null, 2)}
                                    </pre>
                                  </details>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* 訊息文字本體 */}
                          <div className="message-body">
                            {msg.content}
                          </div>

                          <div className="message-actions">
                            <button className="btn-msg-action" onClick={() => copyText(msg.content, "訊息內容")}>
                              複製
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 即時執行狀態 */}
              {statusText && (
                <div className="status-banner">
                  <span className="spinner" />
                  <span>{statusText}</span>
                </div>
              )}

              {/* 底部輸入列 (Command Surface) */}
              <div className="composer-container">
                <form
                  className="composer-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage();
                  }}
                >
                  <div className="composer-input-row">
                    <textarea
                      ref={textareaRef}
                      className="composer-textarea"
                      rows={1}
                      value={input}
                      placeholder={`對 Hermes 說話（上下文：${currentConv.activeProject}）...`}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                    />
                    <button
                      className="btn-send"
                      type="submit"
                      disabled={isGenerating || !input.trim()}
                      title="發送訊息 (Enter)"
                    >
                      {isGenerating ? "…" : "發送 ↵"}
                    </button>
                  </div>
                  <div className="composer-hints">
                    <span>💡 Enter 發送 · Shift + Enter 換行 · 內建 41 個專案與 Zeabur 大腦工具</span>
                    <button type="button" className="link-btn" onClick={() => handleSendMessage("列出當前可用的 Hermes 工具與說明")}>
                      查看可用工具
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* TAB 2: 41 個專案目錄 (Compare & Explore Surface) */}
          {activeTab === "projects" && (
            <div className="panel-container">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">柯能生態系專案地圖（41 專案總目錄）</h2>
                  <p className="panel-desc">可直接將專案帶入 Hermes 聊天上下文進行檢索或架構分析。</p>
                </div>
                <div className="search-bar">
                  <input
                    type="text"
                    placeholder="搜尋專案名稱、關鍵字或標籤..."
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="group-filter-bar">
                {allGroups.map((g) => (
                  <button
                    key={g}
                    className={`filter-btn ${projectGroupFilter === g ? "active" : ""}`}
                    onClick={() => setProjectGroupFilter(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>

              <div className="projects-grid">
                {filteredProjects.map((p) => (
                  <div key={p.name} className="project-card">
                    <div className="card-top">
                      <span className="card-group-tag">{p.group}</span>
                      {p.live && <span className="live-badge">上線中</span>}
                    </div>
                    <h3 className="card-title">{p.name}</h3>
                    <p className="card-blurb">{p.blurb}</p>
                    <div className="card-tags">
                      {p.tags?.map((t) => (
                        <span key={t} className="tag-pill">{t}</span>
                      ))}
                    </div>
                    <div className="card-footer">
                      <a href={p.url} target="_blank" rel="noreferrer" className="card-link">
                        GitHub ↗
                      </a>
                      <div className="card-action-btns">
                        <button
                          className="btn-select-context"
                          onClick={() => {
                            handleSelectProject(p.name);
                            handleSendMessage(`請針對專案 ${p.name} 進行詳細技術架構解析`);
                          }}
                          title="深探專案規格"
                        >
                          深探規格 🔍
                        </button>
                        <button
                          className="btn-select-context active"
                          onClick={() => {
                            handleSelectProject(p.name);
                            setActiveTab("chat");
                          }}
                        >
                          帶入上下文 💬
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: 工具箱 (Command & Inspect Surface) */}
          {activeTab === "tools" && (
            <div className="panel-container">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Hermes Agent 核心工具箱</h2>
                  <p className="panel-desc">Hermes Agent 作為專案之腦，可自動或手動調用以下核心工具。</p>
                </div>
              </div>

              {/* 互動式工具即時執行器 */}
              <div className="tool-runner-sandbox">
                <h3 className="runner-title">⚡ 互動式工具執行台 (Tool Runner Sandbox)</h3>
                <div className="runner-controls">
                  <div className="runner-field">
                    <label>選擇要測試的工具：</label>
                    <select
                      className="form-input"
                      value={selectedToolForRunner}
                      onChange={(e) => {
                        const nextTool = e.target.value;
                        setSelectedToolForRunner(nextTool);
                        if (nextTool === "get_ecosystem_projects") {
                          setToolRunnerArgs(JSON.stringify({ query: "設計", group: "" }, null, 2));
                        } else if (nextTool === "inspect_project") {
                          setToolRunnerArgs(JSON.stringify({ projectName: currentConv.activeProject }, null, 2));
                        } else if (nextTool === "generate_creative_brief") {
                          setToolRunnerArgs(JSON.stringify({ title: "淡大戲劇開幕片", category: "storyboard", keyPoints: ["初見", "波瀾", "靜心", "定格"] }, null, 2));
                        } else if (nextTool === "check_hermes_status") {
                          setToolRunnerArgs(JSON.stringify({ pingOnly: false }, null, 2));
                        } else {
                          setToolRunnerArgs(JSON.stringify({}, null, 2));
                        }
                      }}
                    >
                      {HERMES_TOOLS.map((t) => (
                        <option key={t.function.name} value={t.function.name}>
                          {t.function.name} — {t.function.description.slice(0, 24)}...
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="runner-field">
                    <label>調用參數 (JSON 格式)：</label>
                    <textarea
                      className="form-input font-mono"
                      rows={3}
                      value={toolRunnerArgs}
                      onChange={(e) => setToolRunnerArgs(e.target.value)}
                    />
                  </div>

                  <div className="runner-actions">
                    <button
                      className="btn-primary-action"
                      onClick={handleRunToolTester}
                      disabled={toolRunnerBusy}
                    >
                      {toolRunnerBusy ? "執行中..." : "立即調用工具 ⚡"}
                    </button>
                    {toolRunnerResult && (
                      <button
                        className="btn-atelier-switch"
                        onClick={() => {
                          handleSendMessage(`請針對以下工具 [${selectedToolForRunner}] 的執行結果進行進一步分析：\n\`\`\`json\n${JSON.stringify(toolRunnerResult.result, null, 2)}\n\`\`\``);
                        }}
                      >
                        帶入聊天中對話 💬
                      </button>
                    )}
                  </div>

                  {toolRunnerResult && (
                    <div className="runner-result-box">
                      <div className="result-summary">{toolRunnerResult.summary}</div>
                      <pre className="tool-json">{JSON.stringify(toolRunnerResult.result, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </div>

              <div className="tools-list" style={{ marginTop: 24 }}>
                {HERMES_TOOLS.map((tool) => (
                  <div key={tool.function.name} className="tool-item-card">
                    <div className="tool-card-head">
                      <span className="tool-fn-badge">FUNCTION</span>
                      <code className="tool-fn-name">{tool.function.name}</code>
                    </div>
                    <p className="tool-fn-desc">{tool.function.description}</p>
                    <div className="tool-params-preview">
                      <strong>參數規格：</strong>
                      <pre>{JSON.stringify(tool.function.parameters, null, 2)}</pre>
                    </div>
                    <div className="tool-card-action">
                      <button
                        className="btn-test-tool"
                        onClick={() => handleSendMessage(`請幫我調用 ${tool.function.name} 工具進行測試`)}
                      >
                        在對話中呼叫此工具 ⚡
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: Zeabur 連線設定 (Configure Surface) */}
          {activeTab === "settings" && (
            <div className="panel-container settings-view">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Zeabur Hermes 深度連接設定</h2>
                  <p className="panel-desc">
                    將 hermes-console 與您在 Zeabur 部署的 Hermes Agent 伺服器進行無縫串接。
                  </p>
                </div>
              </div>

              <div className="settings-cards-grid">
                {/* 連線表單 */}
                <div className="settings-box">
                  <h3 className="box-title">API 伺服器網域設定</h3>

                  <div className="domain-presets-row">
                    <span className="preset-label">快速切換已探測網域：</span>
                    <button
                      className="btn-preset-chip"
                      onClick={() => setApiUrl("https://hermes-agent-api.zeabur.app")}
                      title="API 伺服器埠口"
                    >
                      hermes-agent-api.zeabur.app
                    </button>
                    <button
                      className="btn-preset-chip"
                      onClick={() => setApiUrl("https://455.zeabur.app")}
                      title="Web 儀表板埠口"
                    >
                      455.zeabur.app
                    </button>
                  </div>

                  <div className="form-group" style={{ marginTop: 12 }}>
                    <label className="form-label">
                      Zeabur API Server 網域
                      <span className="required-star">*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="https://your-hermes.zeabur.app"
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                    />
                    <span className="form-hint">
                      請填入 Zeabur 上 <code>hermes-agent</code> 綁定之 API 網域。不要在結尾加上 <code>/v1/chat/completions</code>。
                    </span>
                  </div>

                  <div className="form-group">
                    <label className="form-label">API Server Key</label>
                    <div className="key-input-wrap">
                      <input
                        type="text"
                        className="form-input font-mono"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-key-preset"
                        onClick={() => setApiKey(HERMES_DEFAULTS.DEFAULT_API_KEY)}
                        title="重設為 Zeabur 預設 Key"
                      >
                        填入預設 Key
                      </button>
                    </div>
                    <span className="form-hint">預設金鑰：<code>Xn7KpRg8w2vr91aHdeWoIDmTf6Jx0354</code></span>
                  </div>

                  <div className="settings-actions">
                    <button className="btn-save" onClick={handleSaveSettings}>
                      儲存連線設定
                    </button>
                    <button
                      className="btn-test-ping"
                      onClick={() => testZeaburConnection()}
                      disabled={pingStatus === "testing"}
                    >
                      {pingStatus === "testing" ? "測試中..." : "即時 Ping 測試"}
                    </button>
                  </div>

                  {pingStatus === "online" && (
                    <div className="connection-result success">
                      🟢 連線成功！延遲：{pingLatency}ms · Hermes Agent 已在線就緒。
                    </div>
                  )}
                  {pingStatus === "offline" && (
                    <div className="connection-result error">
                      🔴 {pingError || "無法連線至 Zeabur API，請確認域名是否綁定至 API 埠。"}
                      <div style={{ marginTop: 6, fontSize: 11 }}>
                        💡 本系統具備「自動本地沙盒備援」，即使雲端暫時離線，所有 41 個專案檢索與創作工具依然完全可用！
                      </div>
                    </div>
                  )}
                </div>

                {/* Zeabur 儀表板憑證卡片 */}
                <div className="settings-box info-box">
                  <h3 className="box-title">Zeabur 儀表板資訊與憑證</h3>
                  <p className="box-desc">
                    Hermes Agent 服務內建管理後台，可監看 Agent 執行狀態與日誌：
                  </p>

                  <div className="cred-table">
                    <div className="cred-row">
                      <span className="cred-label">API 端點：</span>
                      <code className="cred-val">/v1/chat/completions</code>
                      <button className="btn-copy-sm" onClick={() => copyText("/v1/chat/completions", "API 端點")}>複製</button>
                    </div>
                    <div className="cred-row">
                      <span className="cred-label">儀表板帳號：</span>
                      <code className="cred-val">{HERMES_DEFAULTS.DASHBOARD_USER}</code>
                      <button className="btn-copy-sm" onClick={() => copyText(HERMES_DEFAULTS.DASHBOARD_USER, "帳號")}>複製</button>
                    </div>
                    <div className="cred-row">
                      <span className="cred-label">儀表板密碼：</span>
                      <code className="cred-val">{HERMES_DEFAULTS.DASHBOARD_PASS}</code>
                      <button className="btn-copy-sm" onClick={() => copyText(HERMES_DEFAULTS.DASHBOARD_PASS, "密碼")}>複製</button>
                    </div>
                    <div className="cred-row">
                      <span className="cred-label">預設模型：</span>
                      <code className="cred-val">{HERMES_DEFAULTS.DEFAULT_MODEL}</code>
                    </div>
                  </div>

                  <div className="tips-card">
                    <h4>💡 Zeabur 部署注意事項：</h4>
                    <ol>
                      <li>在 Zeabur 專案管理頁面，為 <strong>hermes-agent</strong> 服務的 API 埠口綁定公開網域。</li>
                      <li>將該網域填入左方的「Zeabur API Server 網域」並儲存。</li>
                      <li>儲存後可隨時使用此控制台呼叫 Hermes 大腦與所有工具！</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
