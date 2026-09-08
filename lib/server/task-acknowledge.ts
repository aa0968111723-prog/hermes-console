import { randomUUID } from "node:crypto";
import type { Task, TaskEvent } from "../contracts";
import { put } from "./store";
import { ApiError, redact } from "./security";
import { taskFor } from "./tasks";

/**
 * Operator acknowledges an uncertain task so the conversation can accept a new
 * submission (retry). Does not claim remote Hermes stopped.
 * LOCAL_CONTRACT helper used by PATCH /api/tasks action=acknowledge.
 */
export function acknowledge(owner: string, id: string): Task {
  const task = taskFor(owner, id);
  if (task.state !== "uncertain")
    throw new ApiError(
      409,
      "not_uncertain",
      "只有結果待確認的任務可以標記為已確認後重試。",
    );
  const now = new Date().toISOString();
  const message =
    "操作者已確認此待確認結果，對話可重新提交；未宣稱遠端工具已停止。";
  task.state = "cancelled";
  task.error = message;
  task.endedAt = now;
  task.updatedAt = now;
  if (task.usage && task.createdAt)
    task.usage.durationMs =
      Date.parse(now) - Date.parse(task.createdAt);
  const record: TaskEvent = {
    id: randomUUID(),
    taskId: task.id,
    toolName: null,
    status: "cancelled",
    startedAt: now,
    endedAt: now,
    summary: redact(message).slice(0, 2000),
    result: null,
    sources: [],
    error: null,
    usage: null,
  };
  task.events = [...(task.events || []), record].slice(-300);
  put("task", owner, task);
  return task;
}
