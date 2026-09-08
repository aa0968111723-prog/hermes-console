import type { Task, TaskEvent } from "../contracts";

export const activityLabels = {
  request: "處理",
  research: "研究",
  creative: "創作",
  audience: "客群",
  memory: "記憶",
  workspace: "素材",
  tool: "工具",
};
export type ActivityKind = keyof typeof activityLabels;
export function activityKind(name: string | null): ActivityKind {
  if (!name) return "request";
  if (
    /galley|xunhe|訊核|tku|tamkang|search|research|browse|fetch|pinterest|instagram/i.test(
      name,
    )
  )
    return "research";
  if (/canva|lumen|framelab|atlas|design|render|poster/i.test(name))
    return "creative";
  if (/audience|persona|twin/i.test(name)) return "audience";
  if (/memory|learning|skill/i.test(name)) return "memory";
  if (/workspace|project|material/i.test(name)) return "workspace";
  return "tool";
}
export function eventState(event: TaskEvent): string {
  return event.status.replace(/^tool\./, "");
}
export function workingEvent(task?: Task | null): TaskEvent | undefined {
  if (!task || !["running", "queued"].includes(task.state)) return;
  const calls = new Map<string, TaskEvent>();
  for (const event of task.events) {
    if (event.toolName) calls.set(event.toolCallId || event.toolName, event);
  }
  return [...calls.values()]
    .reverse()
    .find((event) => ["running", "queued"].includes(eventState(event)));
}
export const taskStateLabel: Record<string, string> = {
  queued: "排隊",
  running: "執行中",
  stopping: "停止確認中",
  completed: "完成",
  failed: "失敗",
  uncertain: "結果待確認",
  cancelled: "已取消",
  waiting_user: "等待確認",
};
export function safeSource(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
