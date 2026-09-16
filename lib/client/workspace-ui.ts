import type { Task } from "@/lib/contracts";

export const taskLabels: Record<string, string> = {
  queued: "準備提交",
  running: "執行中",
  waiting_user: "等待確認",
  waiting_authorization: "等待授權",
  stopping: "停止確認中",
  completed: "已完成",
  failed: "失敗",
  cancelled: "已停止",
  uncertain: "結果待確認",
};

export const connectionLabels: Record<string, string> = {
  unconfigured: "未設定",
  awaiting_authorization: "待授權",
  verifying: "驗證中",
  available: "可用",
  partial: "部分可用",
  failed: "失敗",
};

export function isActiveTask(task: Task) {
  return [
    "queued",
    "running",
    "waiting_user",
    "waiting_authorization",
    "stopping",
  ].includes(task.state);
}

export function formatWorkspaceTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
