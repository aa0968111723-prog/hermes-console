"use client";
import { Activity, Check, ChevronRight, CircleHelp, Clock, TriangleAlert } from "lucide-react";
import type { Task } from "@/lib/contracts";
import {
  activityKind,
  taskStateLabel,
  toolDisplayLabel,
  workingEvent,
} from "@/lib/client/activity";

export function composerTaskStatus(task: Task, offline: boolean) {
  if (offline) return { label: "離線 · 狀態待確認", tone: "warning", tool: null };
  if (task.observationError)
    return { label: "連線異常 · 狀態待確認", tone: "warning", tool: null };
  const tone = task.state === "failed" ? "error"
    : task.state === "uncertain" ? "warning"
    : task.state === "completed" ? "success"
    : ["queued", "waiting_user", "stopping"].includes(task.state) ? "waiting"
    : "neutral";
  const current = workingEvent(task);
  return {
    label: taskStateLabel[task.state] || "狀態未知",
    tone,
    tool: toolDisplayLabel(current?.toolName || null),
    toolName: current?.toolName || null,
    toolKind: current ? activityKind(current.toolName) : null,
  };
}

/** A persistent task shortcut, independent of decorative pet preferences. */
export default function ComposerTaskStatus({ task, offline, onClick }: {
  task: Task;
  offline: boolean;
  onClick: () => void;
}) {
  const status = composerTaskStatus(task, offline);
  const Icon = status.tone === "error" ? TriangleAlert
    : status.tone === "warning" ? CircleHelp
    : status.tone === "success" ? Check
    : status.tone === "waiting" ? Clock : Activity;
  return (
    <button type="button" className="composer-task-status" data-tone={status.tone}
      onClick={onClick} aria-haspopup="dialog"
      aria-label={`查看目前任務：${status.label}${status.tool ? "，" + status.tool : ""}`}>
      <Icon size={17} aria-hidden="true" />
      <span className="composer-task-label">{status.label}</span>
      {status.tool && (
        <span
          className="composer-task-tool"
          data-activity={status.toolKind}
          title={status.toolName ? `技術名稱：${status.toolName}` : undefined}
        >
          {status.tool}
        </span>
      )}
      <ChevronRight className="composer-task-chevron" size={17} aria-hidden="true" />
    </button>
  );
}
