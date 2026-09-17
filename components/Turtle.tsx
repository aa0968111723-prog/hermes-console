"use client";
import { memo, useEffect, useState } from "react";
import type { Task } from "@/lib/contracts";
import {
  activityKind,
  eventState,
  studentHonestyLabel,
  studentTaskLabel,
  taskEvents,
  taskHasWorkspaceResult,
  workingEvent,
} from "@/lib/client/activity";
export function turtleState(task: Task | undefined, offline: boolean) {
  if (offline) return { id: "offline", label: "離線" };
  if (!task) return { id: "idle", label: "準備好了" };
  if (studentHonestyLabel(task))
    return { id: "waiting", label: studentTaskLabel(task) };
  if (task.state === "failed" || task.state === "uncertain")
    return {
      id: "error",
      label: task.state === "uncertain" ? "結果待確認" : "需要你看一下",
    };
  if (task.state === "completed")
    return taskHasWorkspaceResult(task)
      ? { id: "idle", label: "準備好了" }
      : { id: "success", label: "完成了" };
  if (task.state === "waiting_user")
    return { id: "waiting", label: "等你確認" };
  if (task.state === "waiting_authorization")
    return { id: "waiting", label: "等你授權" };
  if (task.state === "stopping")
    return { id: "waiting", label: "正在停下" };
  if (task.state === "cancelled") return { id: "idle", label: "準備好了" };
  if (task.state === "queued")
    return { id: "planning", label: "正在規劃" };
  const tool = workingEvent(task) || taskEvents(task).filter((e) => !!e.toolName).at(-1);
  if (tool?.status === "waiting_authorization")
    return { id: "waiting", label: "等你授權" };
  if (tool?.status === "waiting_user")
    return { id: "waiting", label: "等你確認" };
  if (tool && ["running", "queued"].includes(eventState(tool))) {
    const name = tool.toolName || "";
    if (
      /pinterest|instagram|search|browse|fetch|extract|web/i.test(name) &&
      !/galley|xunhe|tku|tamkang/i.test(name)
    )
      return { id: "searching", label: "正在搜尋" };
    const kind = activityKind(name);
    if (kind === "research") return { id: "researching", label: "正在研究" };
    if (kind === "creative") return { id: "creating", label: "正在創作" };
    if (kind === "audience") return { id: "thinking", label: "正在想想客群" };
    if (kind === "memory" || kind === "workspace")
      return { id: "thinking", label: "正在理解" };
    return { id: "tool", label: "正在整理" };
  }
  return { id: "thinking", label: "正在理解" };
}
export default memo(function Turtle({
  task,
  offline,
  animation,
  size,
  onClick,
  compact = false,
  label,
}: {
  task?: Task;
  offline: boolean;
  animation: boolean;
  size: number;
  onClick?: () => void;
  compact?: boolean;
  label?: string;
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
      aria-label={label || "查看目前任務：" + state.label}
      title={label || state.label}
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
