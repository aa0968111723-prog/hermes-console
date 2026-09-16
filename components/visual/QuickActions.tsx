"use client";

import { Eye, Image, Palette, Search, Sparkles, Users } from "lucide-react";

const actions = [
  { label: "研究", prompt: "幫我找網宣靈感。", icon: Search, tone: "sage" },
  { label: "創作", prompt: "幫我做一張網宣海報。", icon: Sparkles, tone: "gold" },
  { label: "分析", prompt: "請分析這張文宣。", icon: Eye, tone: "mint" },
  {
    label: "客群",
    prompt: "站在目標客群角度看看，路人會不會滑掉。",
    icon: Users,
    tone: "pearl",
  },
  {
    label: "靈感",
    prompt: "幫我找網宣靈感參考。",
    icon: Image,
    tone: "leaf",
  },
  {
    label: "設計",
    prompt: "幫我整理網宣視覺方向。",
    icon: Palette,
    tone: "lime",
  },
] as const;

export default function QuickActions({
  onSelect,
}: {
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="quick-actions" aria-label="快速開始">
      {actions.map(({ label, prompt, icon: Icon, tone }) => (
        <button
          className={`quick-action quick-action-${tone}`}
          key={label}
          title={prompt}
          onClick={() => onSelect(prompt)}
        >
          <span className="quick-action-icon" aria-hidden="true">
            <Icon size={23} strokeWidth={1.8} />
          </span>
          <span className="quick-action-label">{label}</span>
        </button>
      ))}
    </div>
  );
}
