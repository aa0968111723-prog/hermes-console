"use client";
import type { Integration } from "@/lib/server/integrations";
import { Bot, Brain, Brush, Globe2, Layers3, Network, School, Sparkles } from "lucide-react";

const labels: Record<string, string> = {
  unconfigured: "未設定",
  awaiting_authorization: "待授權",
  verifying: "驗證中",
  available: "可用",
  partial: "部分可用",
  failed: "失敗",
};

const icons = [Bot, Network, School, Sparkles, Brain, Layers3, Brush, Globe2];

export default function IntegrationHealth({
  items,
}: {
  items: Integration[];
}) {
  return <ul className="integration-health" aria-label="整合連線狀態">
    {items.map((item, index) => {
      const Icon = icons[index % icons.length];
      const stateLabel = labels[item.state] || item.state;
      return <li className={`integration-tile integration-${item.state}`} key={item.id}>
        <span className="integration-icon" aria-hidden="true"><Icon size={18} /></span>
        <strong>{item.name}</strong>
        <span className="integration-state" title={stateLabel}><i aria-hidden="true" />{stateLabel}</span>
        <details><summary className="integration-details-toggle">詳情</summary><p>{item.detail}</p></details>
      </li>;
    })}
  </ul>;
}
