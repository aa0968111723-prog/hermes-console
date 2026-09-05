"use client";
import { useState } from "react";
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
      <h1>Agent</h1>
      <p className="muted">狀態來自實際 Hermes 探索，未設定不會顯示已連線。</p>
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
    </section>
  );
}
