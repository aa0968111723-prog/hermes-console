import { randomUUID } from "node:crypto";
import { WORKSPACE_OWNER } from "./security";
import { errorCategory, type ErrorCategory } from "./errors";

export function taskObservability(input: {
  taskId: string;
  conversationId: string;
  projectId: string;
}) {
  return {
    taskId: input.taskId,
    traceId: randomUUID(),
    conversationId: input.conversationId,
    workspaceId: WORKSPACE_OWNER,
    projectId: input.projectId,
  };
}

export function eventObservability(input: {
  startedAt: string;
  endedAt: string | null;
  status: string;
  error: string | null;
}): { latencyMs: number | null; errorCategory: ErrorCategory | null } {
  const latencyMs =
    input.endedAt == null
      ? null
      : Math.max(0, Date.parse(input.endedAt) - Date.parse(input.startedAt));
  return {
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    errorCategory:
      input.error || input.status === "failed"
        ? errorCategory(input.status)
        : null,
  };
}
