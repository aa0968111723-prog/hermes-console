"use client";
import { Activity, Check, ChevronRight, CircleHelp, Clock, RefreshCw, TriangleAlert } from "lucide-react";
import type { Task } from "@/lib/contracts";
import {
  activityKind,
  taskStateLabel,
  toolDisplayLabel,
  workingEvent,
} from "@/lib/client/activity";

/** Pill + notice share this offline copy (chat-first; never pretend remote stopped). */
export const OFFLINE_PILL_LABEL = "離線 · 顯示上次資料";
export const OFFLINE_NOTICE =
  "離線 · 顯示上次資料。後端任務不會因關閉頁面而假裝停止。";

/**
 * Offline pill click refreshes only. Any other state opens the task sheet.
 * Never auto-acknowledge or resend the previous user message.
 */
export function composerTaskPillAction(offline: boolean): "refresh" | "open_sheet" {
  return offline ? "refresh" : "open_sheet";
}

/** visibility/online recovery: pull state only; uncertain stays blocked until user confirms. */
export function recoveryOnReconnectAction(): "refresh_only" {
  return "refresh_only";
}

/** Short user-facing error; strip stack frames and hard-cap length. */
export function shortTaskError(text: string | null | undefined, max = 240): string | null {
  if (!text) return null;
  const cutStack = text
    .split(/\n\s+at |\r?\n(?=\s*at )/)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (!cutStack) return null;
  return cutStack.length > max ? cutStack.slice(0, max - 1) + "…" : cutStack;
}

export function composerTaskStatus(task: Task, offline: boolean) {
  if (offline) return { label: OFFLINE_PILL_LABEL, tone: "warning", tool: null };
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
  const action = composerTaskPillAction(offline);
  /* Offline → RefreshCw icon; full aria-label kept for screen readers. */
  const Icon = action === "refresh" ? RefreshCw
    : status.tone === "error" ? TriangleAlert
    : status.tone === "warning" ? CircleHelp
    : status.tone === "success" ? Check
    : status.tone === "waiting" ? Clock : Activity;
  const aria =
    action === "refresh"
      ? `離線：重新整理上次資料（${status.label}）`
      : `查看目前任務：${status.label}${status.tool ? "，" + status.tool : ""}`;
  return (
    <button type="button" className="composer-task-status" data-tone={status.tone}
      data-action={action}
      onClick={onClick} aria-haspopup={action === "open_sheet" ? "dialog" : undefined}
      aria-label={aria}>
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