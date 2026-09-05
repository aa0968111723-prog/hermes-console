import { randomUUID } from "node:crypto";
import type { Task } from "../contracts";
import { WORKSPACE_OWNER } from "./security";
import { list, put } from "./store";

export interface UsageEvent {
  id: string;
  agentId: string;
  model: string | null;
  projectId: string | null;
  conversationId: string | null;
  runId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  toolCalls: number;
  toolErrors: number;
  timestamp: string;
}

export function recordUsage(event: Omit<UsageEvent, "id">) {
  return put("usage_event", WORKSPACE_OWNER, {
    ...event,
    id: randomUUID(),
  } satisfies UsageEvent);
}

export function recordTaskUsage(
  task: Task,
  extra: { agentId?: string; projectId?: string },
) {
  const toolCalls = task.events.filter((event) => event.toolName).length;
  const toolErrors = task.events.filter(
    (event) => event.toolName && event.error,
  ).length;
  return recordUsage({
    agentId: extra.agentId || "general",
    model: task.usage.model,
    projectId: extra.projectId || null,
    conversationId: task.conversationId,
    runId: task.remoteId,
    inputTokens: task.usage.inputTokens,
    outputTokens: task.usage.outputTokens,
    totalTokens: task.usage.totalTokens,
    durationMs: task.usage.durationMs,
    toolCalls,
    toolErrors,
    timestamp: task.endedAt || task.updatedAt,
  });
}

function inRange(timestamp: string, since: number | null) {
  if (!since) return true;
  return Date.parse(timestamp) >= since;
}

export function aggregateUsage(range: "today" | "7d" | "30d" | "all" = "all") {
  const start =
    range === "today"
      ? new Date().setHours(0, 0, 0, 0)
      : range === "7d"
        ? Date.now() - 7 * 86400_000
        : range === "30d"
          ? Date.now() - 30 * 86400_000
          : null;
  const rows = list<UsageEvent>("usage_event", WORKSPACE_OWNER).filter((row) =>
    inRange(row.timestamp, start),
  );
  const sum = (pick: (row: UsageEvent) => number | null) => {
    const values = rows.map(pick).filter((value): value is number => value !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const group = (key: (row: UsageEvent) => string) => {
    const map = new Map<string, { tokens: number | null; count: number }>();
    for (const row of rows) {
      const id = key(row);
      const current = map.get(id) || { tokens: null, count: 0 };
      current.count += 1;
      if (row.totalTokens !== null)
        current.tokens = (current.tokens || 0) + row.totalTokens;
      map.set(id, current);
    }
    return Object.fromEntries(map);
  };
  const durations = rows
    .map((row) => row.durationMs)
    .filter((value): value is number => value !== null);
  const toolCalls = rows.reduce((sum, row) => sum + row.toolCalls, 0);
  const toolErrors = rows.reduce((sum, row) => sum + row.toolErrors, 0);
  return {
    range,
    totalTokens: sum((row) => row.totalTokens),
    inputTokens: sum((row) => row.inputTokens),
    outputTokens: sum((row) => row.outputTokens),
    byAgent: group((row) => row.agentId),
    byModel: group((row) => row.model || "unknown"),
    byProject: group((row) => row.projectId || "none"),
    toolCalls,
    toolErrors,
    errorRate: toolCalls ? toolErrors / toolCalls : null,
    averageDurationMs: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
    cost: null,
    costNotice: "Hermes 未提供價格資訊時不估算費用。",
  };
}
