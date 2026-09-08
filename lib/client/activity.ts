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
export function toolDisplayLabel(name: string | null): string | null {
  if (!name) return null;
  if (/galley/i.test(name)) return "研究 · GALLEY";
  if (/xunhe|訊核/i.test(name)) return "研究 · 訊核";
  if (/tku|tamkang|tamsui/i.test(name)) return "查詢 · 淡江";
  if (/instagram/i.test(name)) return "參考 · Instagram";
  if (/pinterest/i.test(name)) return "參考 · Pinterest";
  if (/canva/i.test(name)) return "創作 · Canva";
  if (/planform/i.test(name)) return "場佈 · Planform";
  if (/framelab/i.test(name)) return "影像 · FrameLab";
  if (/lumen/i.test(name)) return "創作 · Lumen";
  if (/atlas/i.test(name)) return "場景 · Atlas";
  if (/duigao/i.test(name)) return "協作 · 對稿";
  if (/audience|persona|twin/i.test(name)) return "模擬 · 目標客群";
  if (/memory|learning|skill/i.test(name)) return "讀取 · 記憶";
  if (/workspace|project|material/i.test(name)) return "整理 · 工作區";
  if (/search|browse|fetch|extract|web/i.test(name)) return "搜尋 · 網路";
  return activityLabels[activityKind(name)];
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
