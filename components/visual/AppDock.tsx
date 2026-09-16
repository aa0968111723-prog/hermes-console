"use client";
import { Bot, Images, MessageSquare, Sparkles } from "lucide-react";
type Nav = "chat" | "projects" | "inspiration" | "agents" | "tasks";
export default function AppDock({
  nav,
  onNavigate,
}: {
  nav: Nav;
  onNavigate: (nav: Nav) => void;
}) {
  return (
    <nav className="mobile-bottom-dock spatial-dock" aria-label="快速導覽">
      <button
        aria-label="對話"
        aria-current={nav === "chat" ? "page" : undefined}
        onClick={() => onNavigate("chat")}
      >
        <MessageSquare size={21} />
        <span>對話</span>
      </button>
      <button
        aria-label="專案"
        aria-current={nav === "projects" ? "page" : undefined}
        onClick={() => onNavigate("projects")}
      >
        <Images size={21} />
        <span>專案</span>
      </button>
      <button
        aria-label="靈感"
        aria-current={nav === "inspiration" ? "page" : undefined}
        onClick={() => onNavigate("inspiration")}
      >
        <Sparkles size={21} />
        <span>靈感</span>
      </button>
      <button
        aria-label="Agent"
        aria-current={nav === "agents" ? "page" : undefined}
        onClick={() => onNavigate("agents")}
      >
        <Bot size={21} />
        <span>Agent</span>
      </button>
    </nav>
  );
}
