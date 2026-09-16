"use client";
import { useState } from "react";
import { Bot, CircleAlert, CircleDot } from "lucide-react";
import type { AgentProfile } from "@/lib/server/agents";

const agentStatus: Record<AgentProfile["status"], string> = {
  unconfigured: "未設定",
  configured: "已設定",
  reachable: "可連線",
  failed: "失敗",
};
const capabilityStatus: Record<string, string> = {
  available: "可用",
  partial: "部分可用",
  unsupported: "不支援",
  unknown: "未知",
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
          >
            <span className="agent-node-icon" aria-hidden="true">
              <Bot size={19} />
            </span>
            <strong>{agent.displayName}</strong>
            <span
              className="agent-node-status"
              title={agentStatus[agent.status]}
            >
              {agent.status === "failed" ? (
                <CircleAlert size={12} />
              ) : (
                <CircleDot size={12} />
              )}
            </span>
            <span className="sr-only">
              {agentStatus[agent.status]} · {agent.model || "模型未宣告"} ·{" "}
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
              <p>
                狀態：{agentStatus[agent.status]}
                （設定存在或服務可達不等於已可執行）
              </p>
              <p>
                模型：{agent.model || "未知"} · 使用量：
                {agent.usage.totalTokens === null
                  ? "未知"
                  : agent.usage.totalTokens + " tokens"}
              </p>
              <p>
                技能：
                {agent.skills.map((s) => s.name).join("、") || "尚未探索"}
              </p>
              <p>工具：{agent.tools.join("、") || "尚未探索"}</p>
              <p>
                工作階段：
                {capabilityStatus[agent.sessionSupport] || agent.sessionSupport}
              </p>
              <p>
                記憶：
                {capabilityStatus[agent.memorySupport] || agent.memorySupport}
              </p>
              <p>錯誤：{agent.lastError || "無"}</p>
              {brain.some((item) => item.id === agent.id) && (
                <p>僅在實例支援記憶／工作階段時顯示進階記憶。</p>
              )}
            </div>
          ))}
    </section>
  );
}
