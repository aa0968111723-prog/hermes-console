import type { Task, TaskState, Usage } from "../contracts";

export type UsageMetric = {
  key: keyof Usage;
  label: string;
  value: string;
};

export type TaskUsagePresentation = {
  state: "waiting" | "missing" | "available";
  summary: string;
  highlights: UsageMetric[];
  details: UsageMetric[];
};

const activeStates = new Set<TaskState>([
  "queued",
  "running",
  "waiting_user",
  "stopping",
]);

function validNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function number(value: number) {
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 6 });
}

function metric(
  key: keyof Usage,
  label: string,
  value: number | null,
  format: (value: number) => string = number,
): UsageMetric | null {
  return validNumber(value) ? { key, label, value: format(value) } : null;
}

export function presentTaskUsage(
  task: Pick<Task, "state" | "usage">,
): TaskUsagePresentation {
  const usage = task.usage;
  const model = usage.model?.trim()
    ? { key: "model" as const, label: "模型", value: usage.model.trim() }
    : null;
  const total = metric("totalTokens", "總 tokens", usage.totalTokens);
  const duration = metric(
    "durationMs",
    "耗時",
    usage.durationMs,
    (value) => `${(value / 1000).toFixed(1)} 秒`,
  );
  const input = metric("inputTokens", "輸入 tokens", usage.inputTokens);
  const output = metric("outputTokens", "輸出 tokens", usage.outputTokens);
  const providerCost = metric(
    "providerCost",
    "模型供應商費用",
    usage.providerCost,
  );
  const toolCost = metric("toolCost", "外部工具費用", usage.toolCost);

  const highlights = [
    model,
    total,
    ...(total ? [] : [input, output]),
    duration,
  ].filter((item): item is UsageMetric => item !== null);
  const details = [
    ...(total ? [input, output] : []),
    providerCost,
    toolCost,
  ].filter((item): item is UsageMetric => item !== null);
  const count = highlights.length + details.length;

  if (count === 0) {
    const waiting = activeStates.has(task.state);
    return {
      state: waiting ? "waiting" : "missing",
      summary: waiting ? "等待 Hermes 回傳" : "未回傳用量資料",
      highlights: [],
      details: [],
    };
  }

  return {
    state: "available",
    summary: `已回傳 ${count} 項`,
    highlights,
    details,
  };
}
