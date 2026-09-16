"use client";
import {
  ListTodo,
  Menu,
  PanelLeftClose,
  Plus,
  Settings,
} from "lucide-react";
import type { Health } from "@/lib/contracts";

export type ConsoleNav =
  | "chat"
  | "projects"
  | "inspiration"
  | "agents"
  | "tasks";

const TITLES: Record<ConsoleNav, string> = {
  chat: "創作對話",
  projects: "專案與素材",
  inspiration: "靈感",
  agents: "Agent",
  tasks: "任務",
};

export default function TopBar({
  nav,
  mobile,
  projectName,
  sidebar,
  offline,
  health,
  connectionLabel,
  onToggleSidebar,
  onOpenDrawer,
  onOpenTasks,
  onOpenConnections,
  onOpenAppearance,
  onNewChat,
}: {
  nav: ConsoleNav;
  mobile: boolean;
  projectName: string;
  sidebar: boolean;
  offline: boolean;
  health: Health | null;
  connectionLabel: string;
  onToggleSidebar: () => void;
  onOpenDrawer: () => void;
  onOpenTasks: () => void;
  onOpenConnections: () => void;
  onOpenAppearance: () => void;
  onNewChat: () => void;
}) {
  const title = nav === "chat" && mobile ? "Hermes" : TITLES[nav];
  const statusText = offline
    ? "離線"
    : health
      ? connectionLabel
      : "確認連線";
  return (
    <header className="topbar">
      <button
        className="icon-button desktop-toggle"
        aria-label={sidebar ? "收合側欄" : "展開側欄"}
        aria-expanded={sidebar}
        onClick={onToggleSidebar}
      >
        {sidebar ? <PanelLeftClose size={20} /> : <Menu size={20} />}
      </button>
      <button
        className="icon-button mobile-toggle"
        aria-label="開啟導覽"
        hidden
        onClick={onOpenDrawer}
      >
        <Menu size={21} />
      </button>
      <div className="topbar-title">
        {title}
        <span>{projectName}</span>
      </div>
      <button
        className="icon-button topbar-new-chat"
        aria-label="開啟新對話"
        title="開啟新對話"
        onClick={onNewChat}
      >
        <Plus size={20} />
      </button>
      <button
        className="icon-button"
        aria-label="任務與成果"
        title="任務與成果"
        onClick={onOpenTasks}
      >
        <ListTodo size={20} />
      </button>
      <button
        className="connection-pill"
        aria-label={"連線狀態：" + (offline ? "離線" : health ? connectionLabel : "確認中")}
        onClick={onOpenConnections}
      >
        <span
          className={
            "status-dot " + (health?.credential === "valid" ? "good" : "")
          }
        />
        <span className="connection-label">{statusText}</span>
      </button>
      <button
        className="icon-button"
        aria-label="外觀設定"
        onClick={onOpenAppearance}
      >
        <Settings size={19} />
      </button>
    </header>
  );
}
