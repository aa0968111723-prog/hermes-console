"use client";
import {
  Bot,
  Database,
  Search,
  Palette,
  Film,
  Layers,
  School,
  Cloud,
  Network,
} from "lucide-react";
const icons: Record<string, typeof Bot> = {
  hermes: Bot,
  workspace: Database,
  galley: Search,
  atlas: Layers,
  framelab: Film,
  lumen: Palette,
  xunhe: Network,
  tamkang: School,
  zeabur: Cloud,
  canva: Palette,
};
export default function IntegrationGrid({
  items,
  selected,
  onSelect,
}: {
  items: { id: string; name: string; state: string }[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const labels: Record<string, string> = {
    configured: "已設定 · 待驗證",
    connected: "已連線 · 待驗證",
    verified: "已驗證",
    available: "可用",
    partial: "部分可用",
    failed: "失敗",
    unconfigured: "未設定",
    awaiting_authorization: "待授權",
    unknown: "未知",
  };
  return (
    <div className="integration-picker" role="group" aria-label="選擇連線">
      {items.map((item) => {
        const Icon = icons[item.id] || Network;
        return (
          <button
            type="button"
            key={item.id}
            aria-pressed={item.id === selected}
            aria-label={item.name + "：" + (labels[item.state] || item.state)}
            onClick={() => onSelect(item.id === selected ? null : item.id)}
          >
            <Icon size={24} aria-hidden="true" />
            <strong>{item.name}</strong>
            <span className="connection-state" data-state={item.state}>
              <i aria-hidden="true" />
              {labels[item.state] || item.state}
            </span>
          </button>
        );
      })}
    </div>
  );
}
