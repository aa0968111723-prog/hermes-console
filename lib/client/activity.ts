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
  if (
    /canva|lumen|framelab|atlas|planform|design|render|poster|visual_concepts/i.test(
      name,
    )
  )
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
  if (/visual_concepts/i.test(name)) return "視覺 · 概念規格";
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
export const eventStateLabels: Record<string, string> = {
  queued: "排隊",
  running: "執行中",
  waiting_authorization: "等待授權",
  waiting_user: "等待確認",
  completed: "完成",
  failed: "失敗",
  uncertain: "結果待確認",
  cancelled: "已取消",
};
export function eventStateLabel(event: TaskEvent): string {
  return eventStateLabels[eventState(event)] || "狀態未知";
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

const STAGE_ORDER = [
  { kind: "research", label: "研究" },
  { kind: "workspace", label: "整理" },
  { kind: "audience", label: "客群" },
  { kind: "creative", label: "創作" },
] as const;

export function highLevelProgress(task: Task) {
  const calls = new Map<string, TaskEvent>();
  for (const event of task.events)
    if (event.toolName) calls.set(event.toolCallId || event.toolName, event);
  const events = [...calls.values()];
  const current = workingEvent(task);
  const currentKind = current ? activityKind(current.toolName) : null;
  const stages = STAGE_ORDER.filter((stage) =>
    events.some((event) => activityKind(event.toolName) === stage.kind),
  ).map((stage) => {
    const related = events.filter(
      (event) => activityKind(event.toolName) === stage.kind,
    );
    const failed = related.some((event) =>
      /fail|error|waiting_authorization/i.test(eventState(event)),
    );
    const done =
      related.length > 0 &&
      related.every((event) => eventState(event) === "completed");
    const active =
      currentKind === stage.kind &&
      ["running", "queued"].includes(task.state);
    return {
      id: stage.kind,
      label: stage.label,
      state: (failed
        ? "failed"
        : active
          ? "active"
          : done
            ? "done"
            : "pending") as "failed" | "active" | "done" | "pending",
    };
  });
  let label = "理解";
  if (task.state === "completed") label = "完成";
  else if (task.state === "failed") label = "無法完成";
  else if (task.state === "uncertain") label = "結果待確認";
  else if (task.state === "cancelled") label = "已停止";
  else if (
    task.state === "waiting_user" ||
    task.state === "waiting_authorization"
  )
    label = "等待你";
  else if (currentKind === "research") label = "正在研究";
  else if (currentKind === "creative") label = "正在創作";
  else if (currentKind === "audience") label = "正在模擬";
  else if (currentKind === "workspace") label = "正在整理";
  else if (task.state === "running" || task.state === "queued")
    label = "正在理解";
  return { label, stages };
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
  waiting_authorization: "等待授權",
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
