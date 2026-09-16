"use client";
import { useState } from "react";
import { Bot, CircleAlert, CircleDot } from "lucide-react";
import type { AgentProfile } from "@/lib/server/agents";

const STATUS: Record<AgentProfile["status"], string> = {
  unconfigured: "未設定",
  configured: "已設定",
  reachable: "可連線",
  failed: "失敗",
};

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
            aria-label={`${agent.displayName}：${STATUS[agent.status]}`}
          >
            <span className="agent-node-icon" aria-hidden="true">
              <Bot size={19} />
            </span>
            <strong>{agent.displayName}</strong>
            <span className="agent-node-status" title={STATUS[agent.status]}>
              {agent.status === "failed" ? (
                <CircleAlert size={12} />
              ) : (
                <CircleDot size={12} />
              )}
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
              <p>狀態：{STATUS[agent.status]}</p>
              <details>
                <summary>進階 · 能力</summary>
                <p>模型：{agent.model || "尚未宣告"}</p>
                <p>
                  用量：
                  {agent.usage.totalTokens === null
                    ? "尚未回報"
                    : agent.usage.totalTokens + " tokens"}
                </p>
                <p>
                  技能：{agent.skills.map((s) => s.name).join("、") || "尚未探索"}
                </p>
                <p>工具：{agent.tools.join("、") || "尚未探索"}</p>
                <p>會話：{agent.sessionSupport}</p>
                <p>記憶：{agent.memorySupport}</p>
                <p>錯誤：{agent.lastError || "無"}</p>
                {brain.some((item) => item.id === agent.id) && (
                  <p>記憶檢索僅在實例支援時顯示。</p>
                )}
              </details>
            </div>
          ))}
    </section>
  );
}
