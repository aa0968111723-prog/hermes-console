"use client";

import { Bot, Images, MessageSquare, Sparkles } from "lucide-react";

type Nav = "chat" | "projects" | "inspiration" | "agents" | "tasks";
const entries = [
  ["chat", "對話", MessageSquare],
  ["projects", "專案", Images],
  ["inspiration", "靈感", Sparkles],
  ["agents", "Agent", Bot],
] as const;

export default function AppDock({
  nav,
  onNavigate,
}: {
  nav: Nav;
  onNavigate: (next: Nav) => void;
}) {
  return (
    <nav className="mobile-bottom-dock" aria-label="快速導覽">
      {entries.map(([id, label, Icon]) => (
        <button
          key={id}
          aria-label={label}
          aria-current={nav === id ? "page" : undefined}
          onClick={() => onNavigate(id)}
        >
          <Icon size={19} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
