"use client";
import { memo, useEffect, useState } from "react";
import type { Task } from "@/lib/contracts";
export function turtleState(task: Task | undefined, offline: boolean) {
  if (offline) return { id: "error", label: "連線待確認" };
  if (!task) return { id: "idle", label: "陪你把想法慢慢完成" };
  if (task.state === "failed" || task.state === "uncertain")
    return {
      id: "error",
      label: task.state === "uncertain" ? "結果待確認" : "需要處理錯誤",
    };
  if (task.state === "completed")
    return { id: "success", label: "成果已回來了" };
  if (task.state === "waiting_user")
    return { id: "waiting", label: "等待你的確認" };
  if (task.state === "stopping")
    return { id: "waiting", label: "等待 Hermes 確認停止" };
  if (task.state === "cancelled") return { id: "idle", label: "任務已停止" };
  const tool = task.events.filter((e) => !!e.toolName).at(-1);
  if (tool?.status === "waiting_authorization")
    return { id: "waiting", label: "工具需要重新授權" };
  if (tool?.status === "waiting_user")
    return { id: "waiting", label: "工具正在等待你的確認" };
  if (tool && ["running", "queued"].includes(tool.status)) {
    const name = tool.toolName || "";
    if (/tku|tamkang|tamsui/i.test(name))
      return { id: "researching", label: "正在查詢已授權資料" };
    if (
      /pinterest|instagram|inspiration|search|browse|fetch|extract/i.test(name)
    )
      return { id: "searching", label: "正在搜尋設計參考" };
    if (/audience|twin/i.test(name))
      return { id: "thinking", label: "正在建立 Audience Twin" };
    if (/canva|design|autofill/i.test(name))
      return { id: "designing", label: "正在呼叫 Canva" };
    return { id: "tool", label: "Hermes 正在操作工具" };
  }
  return { id: "thinking", label: "Hermes 正在處理請求" };
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
