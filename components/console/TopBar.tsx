"use client";

import { ListTodo, Menu, PanelLeftClose, Settings } from "lucide-react";
import type { Health } from "@/lib/contracts";
import { connectionLabels } from "@/lib/client/workspace-ui";

export type ConsoleNav =
  | "chat"
  | "projects"
  | "inspiration"
  | "agents"
  | "tasks";

export default function TopBar({
  nav,
  mobile,
  sidebar,
  projectName,
  offline,
  health,
  account,
  onToggleSidebar,
  onOpenDrawer,
  onOpenTasks,
  onOpenSettings,
}: {
  nav: ConsoleNav;
  mobile: boolean;
  sidebar: boolean;
  projectName: string;
  offline: boolean;
  health?: Health | null;
  account?: { user?: { name?: string; avatar?: string | null } | null } | null;
  onToggleSidebar: () => void;
  onOpenDrawer: () => void;
  onOpenTasks: () => void;
  onOpenSettings: (tab: "帳號" | "外觀" | "連線") => void;
}) {
  const title =
    nav === "chat"
      ? mobile
        ? "Hermes"
        : "創作對話"
      : nav === "projects"
        ? "專案與素材"
        : nav === "inspiration"
          ? "靈感"
          : nav === "tasks"
            ? "任務"
            : "Agent";
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
        onClick={onOpenDrawer}
      >
        <Menu size={21} />
      </button>
      <div className="topbar-title">
        {title}
        <span>{projectName}</span>
      </div>
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
        aria-label={
          "連線狀態：" +
          (offline
            ? "離線"
            : health
              ? connectionLabels[health.status]
              : "確認中")
        }
        onClick={() => onOpenSettings("連線")}
      >
        <span
          className={
            "status-dot " + (health?.credential === "valid" ? "good" : "")
          }
        />
        <span className="connection-label">
          {offline
            ? "離線"
            : health
              ? connectionLabels[health.status]
              : "確認連線"}
        </span>
      </button>
      <button
        className="icon-button account-chip"
        aria-label="帳號設定"
        onClick={() => onOpenSettings("帳號")}
      >
        {account?.user?.avatar ? (
          <img src={account.user.avatar} alt="" width={28} height={28} />
        ) : (
          <span aria-hidden="true">
            {(account?.user?.name || "H").slice(0, 1)}
          </span>
        )}
      </button>
      <button
        className="icon-button"
        aria-label="外觀設定"
        onClick={() => onOpenSettings("外觀")}
      >
        <Settings size={19} />
      </button>
    </header>
  );
}
