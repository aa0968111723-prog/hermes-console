import {
  DESIGN_WITHOUT_PREVIEW,
  IMAGE_WITHOUT_VISION,
  RESEARCH_WITHOUT_SOURCES,
  type Task,
  type TaskEvent,
} from "../contracts";

export const SPEC_ONLY_DESIGN_LABEL = "規格已保留";
export const RESEARCH_WITHOUT_SOURCES_LABEL = "還沒找到來源";
export const IMAGE_WITHOUT_VISION_LABEL = "還沒看圖";

export function taskKeptSpecOnly(task?: Task | null): boolean {
  if (!task || task.state !== "completed") return false;
  return task.events.some(
    (event) =>
      typeof event.summary === "string" &&
      (event.summary === DESIGN_WITHOUT_PREVIEW ||
        event.summary.includes("沒有假裝設計完成")),
  );
}

export function taskMissingSources(task?: Task | null): boolean {
  if (!task || task.state !== "completed") return false;
  return task.events.some(
    (event) =>
      typeof event.summary === "string" &&
      (event.summary === RESEARCH_WITHOUT_SOURCES ||
        event.summary.includes("沒有假裝已經搜到資料")),
  );
}

export function taskUnverifiedVision(task?: Task | null): boolean {
  if (!task || task.state !== "completed") return false;
  return task.events.some(
    (event) =>
      typeof event.summary === "string" &&
      (event.summary === IMAGE_WITHOUT_VISION ||
        event.summary.includes("沒有假裝已分析畫面")),
  );
}

export function studentHonestyLabel(task?: Task | null): string | null {
  if (taskUnverifiedVision(task)) return IMAGE_WITHOUT_VISION_LABEL;
  if (taskMissingSources(task)) return RESEARCH_WITHOUT_SOURCES_LABEL;
  if (taskKeptSpecOnly(task)) return SPEC_ONLY_DESIGN_LABEL;
  return null;
}

export function studentTaskLabel(task: Task): string {
  return studentHonestyLabel(task) || taskStateLabel[task.state] || "狀態未知";
}

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

/** High-level labels students see. Not tool names, schemas, or call ids. */
export function stepPhaseLabel(title: string): string {
  if (/看圖/.test(title)) return "看圖";
  if (/靈感/.test(title)) return "靈感";
  if (/受眾|客群/.test(title)) return "客群";
  if (/動畫/.test(title)) return "創作";
  if (/場佈/.test(title)) return "創作";
  if (/視覺|創作|文案|Canva/.test(title)) return "創作";
  if (/最終審查/.test(title)) return "完成";
  if (/查資料|來源|禪學社|Drive|研究/.test(title)) return "研究";
  return "理解";
}

export function eventPhaseLabel(
  event: TaskEvent,
  task?: Task | null,
): string {
  const name = event.toolName || "";
  if (/inspiration|pinterest|instagram/i.test(name)) return "靈感";
  if (
    task?.goal?.requiresImageAnalysis &&
    /material|ask_user|image|read_material/i.test(name)
  )
    return "看圖";
  const kind = activityKind(name);
  if (kind === "research") return "研究";
  if (kind === "creative") return "創作";
  if (kind === "audience") return "客群";
  if (kind === "memory" || kind === "workspace" || kind === "request")
    return "理解";
  return "工具";
}

export type ProgressStep = {
  key: string;
  label: string;
  state: "pending" | "running" | "completed" | "failed" | "uncertain";
  active: boolean;
};

function collapsePhases(
  steps: { id: string; title: string }[],
): ProgressStep[] {
  const phases: ProgressStep[] = [];
  for (const step of steps) {
    const label = stepPhaseLabel(step.title);
    const last = phases[phases.length - 1];
    if (last?.label === label) {
      last.key += "," + step.id;
      continue;
    }
    phases.push({
      key: step.id,
      label,
      state: "pending",
      active: false,
    });
  }
  return phases;
}

function applyEventProgress(task: Task, phases: ProgressStep[]) {
  const current = workingEvent(task);
  const activeLabel = current ? eventPhaseLabel(current, task) : null;
  const failed = new Set<string>();
  const completed = new Set<string>();
  for (const event of task.events) {
    if (!event.toolName) continue;
    const label = eventPhaseLabel(event, task);
    const state = eventState(event);
    if (state === "failed" || state === "uncertain") failed.add(label);
    if (state === "completed") completed.add(label);
  }
  let activeIndex = activeLabel
    ? phases.findIndex((phase) => phase.label === activeLabel)
    : -1;
  if (activeIndex < 0 && ["running", "queued"].includes(task.state)) {
    activeIndex = phases.findIndex((phase) => !completed.has(phase.label));
    if (activeIndex < 0) activeIndex = 0;
  }
  const finished = ["completed", "failed", "cancelled", "uncertain"].includes(
    task.state,
  );
  const specOnly = taskKeptSpecOnly(task);
  const missingSources = taskMissingSources(task);
  const unverifiedVision = taskUnverifiedVision(task);
  phases.forEach((phase, index) => {
    if (finished) {
      if (specOnly || missingSources || unverifiedVision) {
        const creativeGap =
          specOnly && (phase.label === "創作" || phase.label === "完成");
        const researchGap =
          missingSources &&
          (phase.label === "研究" || phase.label === "靈感");
        const imageGap = unverifiedVision && phase.label === "看圖";
        phase.state =
          creativeGap || researchGap || imageGap ? "uncertain" : "completed";
        phase.active = false;
        return;
      }
      phase.state =
        task.state === "completed"
          ? "completed"
          : task.state === "cancelled"
            ? "pending"
            : "failed";
      phase.active = false;
      return;
    }
    if (failed.has(phase.label) && index === activeIndex) {
      phase.state = "failed";
      phase.active = true;
      return;
    }
    if (activeIndex >= 0 && index < activeIndex) {
      phase.state = "completed";
      phase.active = false;
      return;
    }
    if (index === activeIndex) {
      phase.state = "running";
      phase.active = true;
      return;
    }
    phase.state = "pending";
    phase.active = false;
  });
}

export function progressSteps(task: Task): ProgressStep[] {
  if (task.plan?.steps?.length) {
    const phases = collapsePhases(task.plan.steps);
    applyEventProgress(task, phases);
    return phases;
  }
  const calls = new Map<string, TaskEvent>();
  for (const event of task.events)
    if (event.toolName) calls.set(event.toolCallId || event.toolName, event);
  const current = workingEvent(task);
  const specOnly = taskKeptSpecOnly(task);
  return [...calls.values()].slice(-4).map((event) => {
    const state = eventState(event);
    let known: ProgressStep["state"] =
      state === "completed" ||
      state === "failed" ||
      state === "uncertain" ||
      state === "running"
        ? state
        : "pending";
    if (
      specOnly &&
      known === "completed" &&
      activityKind(event.toolName) === "creative"
    )
      known = "uncertain";
    if (
      taskMissingSources(task) &&
      known === "completed" &&
      activityKind(event.toolName) === "research"
    )
      known = "uncertain";
    return {
      key: event.id,
      label: activityLabels[activityKind(event.toolName)],
      state: known,
      active: current?.id === event.id,
    };
  });
}

export function studentProcessDone(
  task: Task,
  steps: ProgressStep[] = progressSteps(task),
): boolean {
  if (studentHonestyLabel(task)) return false;
  return (
    task.state === "completed" ||
    (steps.length > 0 && steps.every((step) => step.state === "completed"))
  );
}

export function visualProcessCaption(
  task: Task,
  steps: ProgressStep[] = progressSteps(task),
): string {
  if (studentProcessDone(task, steps)) return "過程完成";
  const honesty = studentHonestyLabel(task);
  if (honesty) return honesty;
  const active = steps.find((step) => step.active);
  if (active) return active.label;
  return taskStateLabel[task.state] || "進行中";
}

export function isCanvaDesign(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const thumbnail = record.thumbnail;
  const urls = record.urls;
  const thumbUrl =
    thumbnail && typeof thumbnail === "object" && !Array.isArray(thumbnail)
      ? (thumbnail as { url?: unknown }).url
      : undefined;
  const edit =
    urls && typeof urls === "object" && !Array.isArray(urls)
      ? (urls as { edit_url?: unknown }).edit_url
      : undefined;
  return (
    typeof record.title === "string" &&
    (typeof thumbUrl === "string" ||
      typeof edit === "string" ||
      typeof record.url === "string")
  );
}

export function designsFromTask(
  task?: Task | null,
): Record<string, unknown>[] {
  const designs: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const event of task?.events || []) {
    const result = event.result;
    const candidates: unknown[] = [result];
    if (result && typeof result === "object" && "design" in result)
      candidates.push((result as { design: unknown }).design);
    for (const candidate of candidates) {
      if (!isCanvaDesign(candidate)) continue;
      const key = String(candidate.id || candidate.title);
      if (seen.has(key)) continue;
      seen.add(key);
      designs.push(candidate);
    }
  }
  return designs;
}

export function isCreativeTask(task?: Task | null): boolean {
  if (!task) return false;
  if (task.goal?.requiresDesign) return true;
  if (task.plan?.steps.some((step) => /Canva|創作|視覺/.test(step.title)))
    return true;
  return task.events.some(
    (event) => activityKind(event.toolName) === "creative",
  );
}

export function artifactsForConversation(
  task: Task | undefined,
  workflows: {
    id: string;
    projectId: string;
    design: Record<string, unknown> | null;
  }[],
  projectId: string,
): { id: string; design: Record<string, unknown> }[] {
  const items: { id: string; design: Record<string, unknown> }[] = [];
  const seen = new Set<string>();
  const push = (id: string, design: Record<string, unknown>) => {
    const key = String(design.id || design.title || id);
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ id, design });
  };
  if (isCreativeTask(task)) {
    for (const workflow of workflows) {
      if (workflow.projectId === projectId && workflow.design)
        push(workflow.id, workflow.design);
    }
  }
  for (const design of designsFromTask(task))
    push(String(design.id || "design"), design);
  return items;
}

/** Never put tool JSON in the normal transcript. Fold it as technical. */
export function eventUserResult(result: unknown): {
  text: string | null;
  technical: string | null;
} {
  if (result == null) return { text: null, technical: null };
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (!trimmed) return { text: null, technical: null };
    if (/^[\[{]/.test(trimmed))
      return { text: null, technical: trimmed.slice(0, 8000) };
    return { text: trimmed.slice(0, 4000), technical: null };
  }
  if (typeof result === "object") {
    try {
      return {
        text: null,
        technical: JSON.stringify(result, null, 2).slice(0, 8000),
      };
    } catch {
      return { text: null, technical: null };
    }
  }
  return { text: String(result), technical: null };
}
