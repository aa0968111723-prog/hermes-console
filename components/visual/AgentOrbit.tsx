"use client";

import { Bot, Brain, Brush, Database, Globe2, Layers3, Network, Search, Sparkles } from "lucide-react";
import type { Task } from "@/lib/contracts";

const nodes = [
  ["研究", Search], ["創作", Brush], ["客群", Globe2], ["GALLEY", Network],
  ["Canva", Layers3], ["Memory", Brain], ["Workspace", Database],
] as const;

export default function AgentOrbit({ task, tools = [] }: { task?: Task | null; tools?: string[] }) {
  const active = task?.events?.filter((event) => event.toolName).at(-1)?.toolName?.toLowerCase() || "";
  return (
    <div className="agent-orbit" aria-label="目前可用能力">
      <span className="orbit-center"><Bot size={19} aria-hidden="true" /></span>
      {nodes.map(([name, Icon], index) => {
        const isActive = active && name.toLowerCase() === active;
        const hasTool = tools.length > 0 && tools.some((item) => item.toLowerCase().includes(name.toLowerCase()));
        return <span className={`orbit-node orbit-node-${index} ${isActive ? "is-working" : ""} ${hasTool ? "" : "is-unknown"}`} key={name} title={name} aria-label={name}><Icon size={15} aria-hidden="true" /></span>;
      })}
      <span className="sr-only">{task ? `目前任務狀態：${task.state}` : "等待任務"}</span>
    </div>
  );
}
