"use client";
import { memo, useEffect, useState } from "react";
import type { Task } from "@/lib/contracts";
export function turtleState(task: Task | undefined, offline: boolean) {
  if (offline) return { id: "offline", label: "連線待確認" };
  if (!task) return { id: "idle", label: "陪你把想法慢慢完成" };
  if (task.state === "failed" || task.state === "uncertain")
    return {
      id: "failed",
      label: task.state === "uncertain" ? "結果待確認" : "需要處理錯誤",
    };
  if (task.state === "completed")
    return { id: "completed", label: "成果已回來了" };
  if (task.state === "waiting_user")
    return { id: "waiting", label: "等待你的確認" };
  if (task.state === "stopping")
    return { id: "waiting", label: "等待 Hermes 確認停止" };
  if (task.state === "cancelled") return { id: "idle", label: "任務已停止" };
  const tool = task.events.filter((e) => !!e.toolName).at(-1);
  if (tool && !["completed", "failed"].includes(tool.status)) {
    return /search|browse|fetch|extract/.test(tool.toolName || "")
      ? { id: "searching", label: "Hermes 正在查找資料" }
      : { id: "tool", label: "Hermes 正在操作工具" };
  }
  return { id: "processing", label: "Hermes 正在處理請求" };
}
export default memo(function Turtle({
  task,
  offline,
  animation,
  size,
  onClick,
  compact = false,
}: {
  task?: Task;
  offline: boolean;
  animation: boolean;
  size: number;
  onClick: () => void;
  compact?: boolean;
}) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    update();
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const state = turtleState(task, offline);
  return (
    <button
      className={"turtle " + (compact ? "compact" : "")}
      onClick={onClick}
      data-state={state.id}
      data-animate={animation && visible}
      style={{ "--turtle-size": size + "px" } as React.CSSProperties}
      aria-label={"查看目前任務：" + state.label}
      title={state.label}
    >
      <img
        src="/mascot/turtle.png"
        alt="頭頂兩片嫩葉、黃腹甲與深綠龜殼的龜龜"
        draggable={false}
      />
      {!compact && <span>{state.label}</span>}
    </button>
  );
});
