"use client";

import { useState, useEffect } from "react";
import type { AgentProfile } from "@/lib/server/agents";
import type { PersonaProfile } from "@/lib/server/audience-twin/types";
import { PersonaCard } from "@/components/audience/AudienceCard";

interface Props {
  agents: AgentProfile[];
  brain: Array<{ id: string; memorySupport: string }>;
  project?: string;
  domain?: "tamkang" | "ntu" | "general";
}

export default function AgentPanel({
  agents,
  brain,
  project,
  domain: initialDomain,
}: Props) {
  const [tab, setTab] = useState<"agents" | "audience">("agents");
  const [open, setOpen] = useState<string | null>(null);

  // 根據傳入的 domain 或 project 決定初始校園領域
  const computeInitialDomain = (): "tamkang" | "ntu" | "general" => {
    if (initialDomain) return initialDomain;
    if (project?.includes("ntu")) return "ntu";
    if (project?.includes("tku") || project?.includes("tamkang")) return "tamkang";
    return "tamkang";
  };

  const [selectedDomain, setSelectedDomain] = useState<"tamkang" | "ntu" | "general">(computeInitialDomain);
  const [personas, setPersonas] = useState<PersonaProfile[]>([]);
  const [loadingPersonas, setLoadingPersonas] = useState(false);

  // 載入當前領域的 Personas
  useEffect(() => {
    let cancelled = false;
    setLoadingPersonas(true);
    fetch(`/api/audience-twin/personas?domain=${encodeURIComponent(selectedDomain)}`, {
      credentials: "same-origin",
    })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.ok && Array.isArray(data.personas)) {
          setPersonas(data.personas);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingPersonas(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDomain]);

  return (
    <section className="agent-panel">
      <div className="agent-panel-header">
        <div className="agent-panel-title-row">
          <h1>Agent</h1>
          <div className="agent-panel-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "agents"}
              className={`agent-tab-btn ${tab === "agents" ? "active" : ""}`}
              onClick={() => setTab("agents")}
            >
              🤖 系統代理 ({agents.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "audience"}
              className={`agent-tab-btn ${tab === "audience" ? "active" : ""}`}
              onClick={() => setTab("audience")}
            >
              👥 受眾雙生 (Audience Twin)
            </button>
          </div>
        </div>
        <p className="muted">
          {tab === "agents"
            ? "狀態來自實際 Hermes 探索，未設定不會顯示已連線。"
            : "5 位跨校園立體 Persona 模擬角色，提供宣傳素材客觀受眾回饋、痛點檢驗與辯論共識。"}
        </p>
      </div>

      {tab === "agents" ? (
        <>
          <div className="agent-grid">
            {agents.map((agent) => (
              <button
                key={agent.id}
                className="agent-card"
                onClick={() => setOpen(open === agent.id ? null : agent.id)}
                aria-expanded={open === agent.id}
              >
                <strong>{agent.displayName}</strong>
                <span>{agent.status === "unconfigured" ? "Unconfigured" : agent.status}</span>
                <span>{agent.model || "模型未宣告"}</span>
                <span>
                  {agent.usage.totalTokens === null
                    ? "使用量未知"
                    : agent.usage.totalTokens + " tokens"}
                </span>
              </button>
            ))}
          </div>
          {open &&
            agents
              .filter((agent) => agent.id === open)
              .map((agent) => (
                <div key={agent.id} className="agent-detail">
                  <h2>{agent.displayName}</h2>
                  <p>{agent.description}</p>
                  <p>Skills：{agent.skills.map((s) => s.name).join("、") || "尚未探索"}</p>
                  <p>Tools：{agent.tools.join("、") || "尚未探索"}</p>
                  <p>Sessions：{agent.sessionSupport}</p>
                  <p>Memory：{agent.memorySupport}</p>
                  <p>Errors：{agent.lastError || "無"}</p>
                  {brain.some((item) => item.id === agent.id) && (
                    <p>Agent Brain 僅在實例支援記憶／session 時顯示。</p>
                  )}
                </div>
              ))}
        </>
      ) : (
        <div className="audience-personas-container">
          <div className="domain-selector-bar">
            <span className="domain-selector-label">🎯 切換目標校園受眾脈絡：</span>
            <div className="domain-selector-pills">
              <button
                type="button"
                className={`domain-pill-btn ${selectedDomain === "tamkang" ? "active" : ""}`}
                onClick={() => setSelectedDomain("tamkang")}
              >
                🏫 淡江大學 (Tamkang)
              </button>
              <button
                type="button"
                className={`domain-pill-btn ${selectedDomain === "ntu" ? "active" : ""}`}
                onClick={() => setSelectedDomain("ntu")}
              >
                🚲 臺灣大學 (NTU)
              </button>
              <button
                type="button"
                className={`domain-pill-btn ${selectedDomain === "general" ? "active" : ""}`}
                onClick={() => setSelectedDomain("general")}
              >
                🎓 通用大專 (General)
              </button>
            </div>
          </div>

          {loadingPersonas ? (
            <div className="personas-loading-state">載入校園受眾雙生畫像中...</div>
          ) : personas.length > 0 ? (
            <div className="personas-showcase-grid">
              {personas.map((p) => (
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
    </section>
  );
}
