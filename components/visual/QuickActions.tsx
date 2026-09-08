"use client";

import { Eye, Image, Palette, Search, Sparkles, Users } from "lucide-react";

type QuickAction = {
  label: string;
  prompt: string;
  icon: typeof Search;
  tone: string;
};

const actions: QuickAction[] = [
  { label: "研究", prompt: "幫我找網宣靈感。", icon: Search, tone: "sage" },
  {
    label: "創作",
    prompt: "幫我做一張網宣海報。",
    icon: Sparkles,
    tone: "gold",
  },
  { label: "分析", prompt: "請分析這張文宣。", icon: Eye, tone: "mint" },
  {
    label: "客群",
    prompt: "站在目標客群角度看看，路人會不會滑掉。",
    icon: Users,
    tone: "pearl",
  },
  {
    label: "靈感",
    prompt: "幫我找 IG 與 Pinterest 參考，貼連結或使用已授權來源。",
    icon: Image,
    tone: "leaf",
  },
  {
    label: "設計",
    prompt: "幫我做 Canva 草稿；若未授權請保留進度。",
    icon: Palette,
    tone: "lime",
  },
];

export default function QuickActions({
  onSelect,
  mobile = false,
}: {
  onSelect: (prompt: string) => void;
  mobile?: boolean;
}) {
  return (
    <div className="quick-actions" aria-label="快速開始">
      {(mobile ? [
        {label:"找靈感",prompt:"幫我找網宣靈感。",icon:Search,tone:"sage"},
        {label:"做企劃",prompt:"幫我規劃活動網宣，先一起確認活動資訊與受眾。",icon:Sparkles,tone:"gold"},
        {label:"分析圖片",prompt:"請分析我上傳的圖片，整理構圖、配色與資訊層級。",icon:Eye,tone:"mint"},
        {label:"開始任務",prompt:"我想開始一個網宣任務，請先協助釐清目標與需要的素材。",icon:Palette,tone:"pearl"},
      ] : actions).map(({ label, prompt, icon: Icon, tone }) => (
        <button
          className={`quick-action quick-action-${tone}`}
          key={label}
          onClick={() => onSelect(prompt)}
        >
          <span className="quick-action-icon" aria-hidden="true">
            <Icon size={23} strokeWidth={1.8} />
          </span>
          <span className="quick-action-label">{label}</span>
          <span className="quick-action-detail">
            {prompt.replace(/[。；].*$/, "")}
          </span>
        </button>
      ))}
    </div>
  );
}
