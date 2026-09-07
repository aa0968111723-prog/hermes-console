"use client";
import { useState } from "react";
import { Bot, CircleAlert, CircleDot } from "lucide-react";
import type { AgentProfile } from "@/lib/server/agents";

export default function AgentPanel({
  agents,
  brain,
}: {
  agents: AgentProfile[];
  brain: Array<{ id: string; memorySupport: string }>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="agent-panel">
      <h2 className="sr-only">Agent 節點</h2>
      <div className="agent-grid">
        {agents.map((agent) => (
          <button
            key={agent.id}
            className={`agent-card agent-card-${agent.status}`}
            onClick={() => setOpen(open === agent.id ? null : agent.id)}
            aria-expanded={open === agent.id}
          >
            <span className="agent-node-icon" aria-hidden="true"><Bot size={19} /></span>
            <strong>{agent.displayName}</strong>
            <span className="agent-node-status" title={agent.status}>{agent.status === "failed" ? <CircleAlert size={12} /> : <CircleDot size={12} />}</span>
            <span className="sr-only">{agent.status === "unconfigured" ? "未設定" : agent.status} · {agent.model || "模型未宣告"} · {agent.usage.totalTokens === null ? "使用量未知" : agent.usage.totalTokens + " tokens"}</span>
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
              <p>狀態：{agent.status}（設定存在或服務可達不等於 Agent 已可執行）</p>
              <p>模型：{agent.model || "未知"} · 使用量：{agent.usage.totalTokens === null ? "未知" : agent.usage.totalTokens + " tokens"}</p>
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
    </section>
  );
}
