"use client";
import { memo, useEffect, useState } from "react";
import {
  Bot,
  Brain,
  Palette,
  Database,
  Network,
  Search,
  School,
  Film,
  Layers,
  X,
} from "lucide-react";
import type { Task } from "@/lib/contracts";
import type { Integration } from "@/lib/server/integrations";
import type { HermesRuntimeSnapshot } from "@/lib/runtime";
import { workingEvent } from "@/lib/client/activity";
const statusNames: Record<string, string> = {
  available: "可用",
  partial: "部分可用",
  failed: "失敗",
  stale: "待重新驗證",
  unconfigured: "未設定",
  awaiting_authorization: "待授權",
  unknown: "未知",
  unsupported: "不支援",
  syncing: "驗證中",
  verifying: "驗證中",
};
function iconFor(name: string) {
  if (/galley|xunhe|search/i.test(name)) return Search;
  if (/tamkang|tku/i.test(name)) return School;
  if (/planform/i.test(name)) return Layers;
  if (/duigao|對稿/i.test(name)) return Palette;
  if (/lumen|canva/i.test(name)) return Palette;
  if (/framelab/i.test(name)) return Film;
  if (/atlas/i.test(name)) return Layers;
  if (/memory/i.test(name)) return Brain;
  if (/workspace|project/i.test(name)) return Database;
  return Network;
}
export default memo(function AgentOrbit({
  task,
  integrations = [],
  snapshot,
  stale = false,
  compact = false,
  animation = true,
}: {
  task?: Task | null;
  integrations?: Integration[];
  snapshot?: HermesRuntimeSnapshot | null;
  stale?: boolean;
  compact?: boolean;
  animation?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const current = stale ? undefined : workingEvent(task);
  const nodes = snapshot
    ? snapshot.mcpServers.map((server) => ({
        id: server.id,
        name: server.name,
        status: stale
          ? "stale"
          : !server.enabled
            ? "unconfigured"
            : server.status,
        detail: server.lastError,
        verifiedAt: server.lastConnectedAt,
        tools: snapshot.tools
          .filter((tool) => tool.sourceServer === server.id)
          .map((tool) => tool.canonicalName),
      }))
    : integrations
        .filter((item) => item.id !== "hermes")
        .map((item) => ({
          id: item.id,
          name: item.name,
          status: item.state,
          detail: item.detail,
          verifiedAt: item.verifiedAt,
          tools: item.tools,
        }));
  const chosen = nodes.find((node) => node.id === selected);
  return (
    <div
      className={compact ? "orbit-layout compact-orbit" : "orbit-layout"}
      data-animate={animation && visible}
    >
      <div className="agent-orbit" role="group" aria-label="能力連線圖">
        <svg
          className="orbit-beams"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {nodes.map((node, index) => {
            const angle = (index * Math.PI * 2) / nodes.length - Math.PI / 2;
            const working =
              !!current &&
              (node.tools.includes(current.toolName!) ||
                current
                  .toolName!.toLowerCase()
                  .includes(node.id.toLowerCase()));
            return (
              <line
                key={node.id}
                x1="50"
                y1="50"
                x2={50 + 40 * Math.cos(angle)}
                y2={50 + 39 * Math.sin(angle)}
                data-working={working}
              />
            );
          })}
        </svg>
        <span className="orbit-center">
          <Bot size={22} aria-hidden="true" />
          <span className="sr-only">Hermes</span>
        </span>
        {nodes.map((node, index) => {
          const Icon = iconFor(node.id);
          const angle = (index * Math.PI * 2) / nodes.length - Math.PI / 2;
          const working =
            !!current &&
            (node.tools.includes(current.toolName!) ||
              current.toolName!.toLowerCase().includes(node.id.toLowerCase()));
          return (
            <button
              type="button"
              className="orbit-node"
              key={node.id}
              data-status={node.status}
              data-working={working}
              style={{
                left: 50 + 40 * Math.cos(angle) + "%",
                top: 50 + 39 * Math.sin(angle) + "%",
              }}
              aria-label={
                node.name + "：" + (statusNames[node.status] || node.status)
              }
              aria-pressed={selected === node.id}
              onClick={() => setSelected(selected === node.id ? null : node.id)}
            >
              <Icon size={19} aria-hidden="true" />
              <span className="orbit-tooltip">{node.name}</span>
            </button>
          );
        })}
        {!nodes.length && <span className="orbit-empty">尚未取得工具清單</span>}
      </div>
      {chosen && (
        <section
          className="orbit-detail"
          aria-label={chosen.name + " 連線詳情"}
        >
          <button
            className="icon-button"
            aria-label="關閉能力詳情"
            onClick={() => setSelected(null)}
          >
            <X size={18} />
          </button>
          <h3>{chosen.name}</h3>
          <p>{statusNames[chosen.status] || chosen.status}</p>
          {chosen.detail && <p>{chosen.detail}</p>}
          <small>
            最後驗證：
            {chosen.verifiedAt
              ? new Date(chosen.verifiedAt).toLocaleString("zh-TW")
              : "尚無紀錄"}
          </small>
          <details>
            <summary>工具清單（{chosen.tools.length}）</summary>
            <ul>
              {chosen.tools.map((tool) => (
                <li key={tool}>{tool}</li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
});
