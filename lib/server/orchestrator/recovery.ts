import type { Task } from "../../contracts";

export type ResumeState = "running" | "completed" | "failed" | "unknown";

export function classifyResume(task: Task, workerAlive: boolean): ResumeState {
  if (task.state === "completed") return "completed";
  if (task.state === "failed" || task.state === "cancelled") return "failed";
  if (task.state === "uncertain") return "unknown";
  if (task.transport === "runs" && task.remoteId) return "running";
  if (task.transport === "chat" && workerAlive) return "running";
  if (["queued", "running", "waiting_user", "stopping"].includes(task.state) && !workerAlive)
    return "unknown";
  return "unknown";
}

export function resumeNotice(state: ResumeState) {
  if (state === "unknown") return "遠端狀態尚未確認。不會自動重新送出。";
  if (state === "running") return "任務仍在執行，已查回現況。";
  if (state === "failed") return "任務已失敗或已停止。";
  return "任務已完成。";
}
