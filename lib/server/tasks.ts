import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  Conversation,
  DESIGN_WITHOUT_PREVIEW,
  EMPTY_USAGE,
  IMAGE_WITHOUT_VISION,
  RESEARCH_WITHOUT_SOURCES,
  Task,
  TaskEvent,
} from "../contracts";
import { get, list, put, transaction } from "./store";
import { ApiError, hash, limited, redact } from "./security";
import { studentHermesError, STUDENT_IMAGE_UNVERIFIED } from "./errors";
import { studentConnectionMessage } from "./hermes/health-view";
import {
  deadline,
  ensureHermesReady,
  health,
  httpError,
  readJSON,
  serviceIdentity,
  sessionKeyFor,
  streamPreview,
  upstream,
  usage,
  visibleText,
} from "./hermes";
import { budgetFromEnv } from "./budgets";
import {
  fitTaskInputBudget,
  historyTokenBudget,
  windowConversationHistory,
} from "./context/history";
import { classifyIntent, isFastTier } from "./orchestrator/intent";
import {
  composeTaskInstructions,
  dropOptionalPacks,
  focusInstructions,
} from "./orchestrator/instructions";
import { recordTaskUsage } from "./usage";
import { attachmentParts, material } from "./materials";
import { frames } from "./sse";
import { parseAssistantMode } from "../assistant-modes";
import {
  formatResearchPlanForInstructions,
  researchBundle,
} from "./research/providers";
import { executeResearchBundle } from "./research/executor";
import { runtimeEnv } from "./credentials";
import { prepareOrchestration } from "./orchestrator/executor";
import { framelabTaskInstructions } from "./framelab";
import { lumenTaskInstructions } from "./lumen";
import { classifyResume, resumeNotice } from "./orchestrator/recovery";
import { toolEventHasUsableOutput } from "./tool-result";
import {
  interpretGoal,
  userFacingGoalText,
  wantsNewVisual,
} from "./orchestrator/goal";
import { listArtifacts } from "./artifacts";
import {
  searchInspiration,
  toInspirationPack,
} from "./inspiration/engine";
import { persistSelectedDirectionDraft } from "./inspiration/persist";
import {
  applyTypeEnlarge,
  isContinueSameWorkRequest,
  isSpecRevisionRequest,
} from "./inspiration/revise";
import { isInspirationSearchPack } from "../inspiration-pack";
import { isImageReviewPack, workspaceImageReview } from "../image-review";
import { isDirectionBriefPack } from "../direction-brief";
import { simulateFreshmanReactions } from "./audience/personas";
import { attachDirectionBrief, listWorkflows, workflow } from "./workflows";
import { activity, copyDocument } from "./creative";
import type { StructuredGoal } from "../contracts";

const runtimeTasks = globalThis as typeof globalThis & {
  hermesWorkers?: Map<string, AbortController>;
  hermesObservers?: Set<string>;
};
const workers = (runtimeTasks.hermesWorkers ??= new Map<
  string,
  AbortController
>());
const now = () => new Date().toISOString();
export {
  DEFAULT_HISTORY_WINDOW,
  fitTaskInputBudget,
  windowConversationHistory,
} from "./context/history";
export { DESIGN_WITHOUT_PREVIEW, IMAGE_WITHOUT_VISION, RESEARCH_WITHOUT_SOURCES };
export const active = (t: Task) =>
  ["queued", "running", "waiting_user", "waiting_authorization", "stopping"].includes(t.state);
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
const taskFocus = z
  .object({
    copyId: z.string().uuid().optional(),
    revision: z.number().int().positive().optional(),
    workflowId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    direction: z.number().int().positive().optional(),
    activityId: z.string().uuid().optional(),
  })
  .strict()
  .refine((value) => !!(value.copyId || value.workflowId || value.activityId), {
    message: "接續目標不完整。",
  });
export const taskInput = z
  .object({
    conversationId: z.string().uuid(),
    requestKey: z.string().uuid(),
    input: z.string().trim().min(1).max(20_000),
    attachments: z.array(z.string().uuid()).max(4).default([]),
    mode: z.enum(["creative", "research", "admin"]).optional(),
    budgetMode: z.enum(["fast", "balanced", "deep"]).optional(),
    focus: taskFocus.optional(),
  })
  .strict();
function save(owner: string, task: Task) {
  const stored = get<Task>("task", owner, task.id);
  const merged = new Map(task.events.map((event) => [event.id, event]));
  for (const event of stored?.events || []) {
    const existing = merged.get(event.id);
    if (!existing || (!existing.endedAt && event.endedAt))
      merged.set(event.id, event);
  }
  task.events = Array.from(merged.values())
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(-300);
  task.updatedAt = now();
  put("task", owner, task);
  return task;
}
export function conversation(owner: string, id: string) {
  const value = get<Conversation>("conversation", owner, id);
  if (!value) throw new ApiError(404, "not_found", "找不到對話。");
  return value;
}
export function taskFor(owner: string, id: string) {
  const value = get<Task>("task", owner, id);
  if (!value) throw new ApiError(404, "not_found", "找不到任務。");
  return value;
}
export function hasCompletedToolEvents(task: Task) {
  return task.events.some((event) => {
    const isTool = event.kind === "tool" || Boolean(event.toolName);
    const done =
      event.status === "completed" || event.status === "tool.completed";
    return isTool && done && toolEventHasUsableOutput(event);
  });
}
function event(
  task: Task,
  summary: string,
  status: string = task.state,
  toolName: string | null = null,
  result: unknown = null,
) {
  const record: TaskEvent = {
    id: randomUUID(),
    taskId: task.id,
    ...(toolName ? { kind: "tool" as const } : {}),
    toolName,
    status,
    startedAt: now(),
    endedAt: ["completed", "failed", "cancelled"].includes(status)
      ? now()
      : null,
    summary: redact(summary).slice(0, 2000),
    result,
    sources: [],
    error: status === "failed" ? task.error : null,
    usage: null,
  };
  task.events.push(record);
  if (task.events.length > 300) task.events.shift();
}
function failedToolEvents(task: Task) {
  return task.events.filter((event) => {
    const isTool = event.kind === "tool" || Boolean(event.toolName);
    return (
      isTool &&
      (event.status === "failed" ||
        event.status === "tool.failed" ||
        event.status === "uncertain")
    );
  });
}

export function isGroundedSource(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function taskHasGroundedSources(task: Task): boolean {
  return task.events.some((event) =>
    (event.sources || []).some(isGroundedSource),
  );
}

export function taskHasVisualArtifact(owner: string, task: Task) {
  try {
    const conv = conversation(owner, task.conversationId);
    const started = Date.parse(task.createdAt) - 2000;
    if (
      listArtifacts(owner, conv.projectId).some(
        (row) => row.source === "copy" && Date.parse(row.createdAt) >= started,
      )
    )
      return true;
    if (
      listWorkflows(owner).some(
        (row) =>
          row.projectId === conv.projectId &&
          row.design &&
          Date.parse(row.updatedAt) >= started,
      )
    )
      return true;
    return task.events.some((event) => {
      const done =
        event.status === "completed" || event.status === "tool.completed";
      if (!done || !toolEventHasUsableOutput(event)) return false;
      const text =
        (typeof event.result === "string"
          ? event.result
          : JSON.stringify(event.result ?? "")) + event.summary;
      return /canva\.com\/design|"thumbnail"|preview_url/i.test(text);
    });
  } catch {
    return false;
  }
}

function honestyMark(notice: string): string {
  if (notice.includes("假裝設計")) return "沒有假裝設計完成";
  if (notice.includes("假裝已經搜到")) return "沒有假裝已經搜到資料";
  if (notice.includes("假裝已分析畫面") || notice.includes("假裝已看圖"))
    return "沒有假裝已分析畫面";
  return notice;
}

function honestyNotices(owner: string, task: Task, state: Task["state"]) {
  if (state !== "completed") return [] as string[];
  const notices: string[] = [];
  const visionOff = process.env.HERMES_IMAGE_INPUT !== "true";
  if (task.goal?.requiresImageAnalysis && visionOff)
    notices.push(IMAGE_WITHOUT_VISION);
  if (
    (task.goal?.requiresResearch || task.goal?.requiresTamkang) &&
    !taskHasGroundedSources(task)
  )
    notices.push(RESEARCH_WITHOUT_SOURCES);
  const askedForNewVisual =
    wantsNewVisual(task.input) ||
    wantsNewVisual(task.goal?.goal || "") ||
    !!task.focus?.copyId ||
    !!task.focus?.workflowId;
  if (
    task.goal?.requiresDesign &&
    askedForNewVisual &&
    !taskHasVisualArtifact(owner, task)
  )
    notices.push(DESIGN_WITHOUT_PREVIEW);
  return notices;
}

function applyHonestyOutput(task: Task, notices: string[]) {
  if (!notices.length) return;
  const body = task.output.trim();
  const extra = notices.filter((notice) => !body.includes(notice));
  if (!extra.length) return;
  task.output = body ? body + "\n\n" + extra.join("\n\n") : extra.join("\n\n");
}

function finish(
  owner: string,
  task: Task,
  state: Task["state"],
  error: string | null = null,
) {
  if (state === "completed" && failedToolEvents(task).length)
    event(task, "部分步驟目前做不到，只保留已確認的內容。", "fallback");
  const notices = honestyNotices(owner, task, state);
  for (const notice of notices) {
    const mark = honestyMark(notice);
    if (!task.events.some((item) => item.summary.includes(mark)))
      event(task, notice, "fallback");
  }
  task.state = state;
  task.error = error ? studentHermesError(error) : null;
  task.endedAt = now();
  task.usage.durationMs = Date.parse(task.endedAt) - Date.parse(task.createdAt);
  event(
    task,
    task.error ||
      (state === "completed"
        ? notices[0] || "Hermes 已回傳完成結果。"
        : state === "cancelled"
          ? "Hermes 已確認停止。"
          : "任務已結束。"),
  );
  if (state === "completed") {
    applyHonestyOutput(task, notices);
    const conv = conversation(owner, task.conversationId);
    if (
      !conv.messages.some((m) => m.taskId === task.id && m.role === "assistant")
    )
      conv.messages.push({
        id: randomUUID(),
        role: "assistant",
        content: task.output,
        createdAt: now(),
        taskId: task.id,
        provenance: "hermes",
      });
    conv.updatedAt = now();
    put("conversation", owner, conv);
    if (!notices.length)
      put("agent", owner, {
        id: "verified",
        verifiedAt: now(),
        targetHash: serviceIdentity(),
      });
    recordTaskUsage(task, {
      agentId: "general",
      projectId: conv.projectId,
    });
  }
  return save(owner, task);
}
export async function submit(owner: string, input: z.infer<typeof taskInput>) {
  const conv = conversation(owner, input.conversationId);
  for (const id of input.attachments)
    if (material(owner, id).projectId !== conv.projectId)
      throw new ApiError(403, "scope_mismatch", "附件不屬於此專案。");
  if (input.focus?.copyId) {
    const doc = copyDocument(owner, input.focus.copyId);
    if (doc.projectId !== conv.projectId)
      throw new ApiError(403, "scope_mismatch", "作品不屬於此專案。");
  }
  if (input.focus?.workflowId) {
    const record = workflow(owner, input.focus.workflowId);
    if (record.projectId !== conv.projectId)
      throw new ApiError(403, "scope_mismatch", "創作方向不屬於此專案。");
  }
  if (input.focus?.activityId) {
    const record = activity(owner, input.focus.activityId);
    if (record.projectId !== conv.projectId)
      throw new ApiError(403, "scope_mismatch", "活動不屬於此專案。");
  }
  const payloadHash = hash(JSON.stringify(input));
  const existing = list<Task>("task", owner).find(
    (t) => t.requestKey === input.requestKey,
  );
  if (existing) {
    if (existing.payloadHash !== payloadHash)
      throw new ApiError(
        409,
        "idempotency_conflict",
        "此提交識別已用於不同內容。",
      );
    return existing;
  }
  limited("tasks:" + owner, 20, 60_000);
  const connection = await ensureHermesReady(owner);
  const goal = interpretGoal(input.input, {
    hasImage: input.attachments.length > 0,
    focus: input.focus,
  });
  const localInspiration = canFulfillLocalInspiration(
    connection.credential,
    goal,
    input.attachments,
  );
  const localImageReview = canFulfillLocalImageReview(
    connection.credential,
    goal,
  );
  const localSpecRevision = canFulfillLocalSpecRevision(
    connection.credential,
    input.input,
    conv,
    owner,
  );
  const localContinue = canFulfillLocalContinue(
    connection.credential,
    input.input,
    conv,
    owner,
  );
  if (localImageReview && imageAttachmentIds(owner, input.attachments).length < 1)
    throw new ApiError(
      400,
      "invalid_input",
      "請先附上海報或圖片。沒有畫面時無法審查，也不會假裝已看圖。",
    );
  if (
    connection.credential !== "valid" &&
    !localImageReview &&
    process.env.HERMES_IMAGE_INPUT !== "true" &&
    imageAttachmentIds(owner, input.attachments).length > 0
  )
    throw new ApiError(
      409,
      "images_unverified",
      STUDENT_IMAGE_UNVERIFIED,
    );
  if (!localInspiration && !localImageReview && !localSpecRevision && !localContinue)
    await attachmentParts(owner, input.attachments);
  if (
    connection.credential !== "valid" &&
    !localInspiration &&
    !localImageReview &&
    !localSpecRevision &&
    !localContinue
  )
    throw new ApiError(
      503,
      "hermes_not_ready",
      studentConnectionMessage(connection),
    );
  const native =
    !localInspiration &&
    !localImageReview &&
    !localSpecRevision &&
    !localContinue &&
    connection.features.run_submission &&
    connection.features.run_status &&
    input.attachments.length === 0;
  const task: Task = {
    id: randomUUID(),
    conversationId: conv.id,
    requestKey: input.requestKey,
    payloadHash,
    state: "queued",
    transport: native ? "runs" : "chat",
    remoteId: null,
    input: input.input,
    attachments: input.attachments,
    output: "",
    createdAt: now(),
    updatedAt: now(),
    endedAt: null,
    error: null,
    observationError: null,
    events: [],
    usage: { ...EMPTY_USAGE },
    stopSupported: !!(native && connection.features.run_stop),
    budgetMode: input.focus
      ? input.budgetMode || "balanced"
      : isFastTier(
            classifyIntent(input.input, {
              hasImage: input.attachments.length > 0,
            }),
          )
        ? "fast"
        : input.budgetMode || "balanced",
    focus: input.focus || null,
  };
  const mode = parseAssistantMode(input.mode ?? conv.assistantMode);
  if (mode === "research") task.researchBundle = researchBundle({ prompt: input.input });
  const reserved = transaction(() => {
    const duplicate = list<Task>("task", owner).find(
      (t) => t.requestKey === input.requestKey,
    );
    if (duplicate) return duplicate;
    if (
      list<Task>("task", owner).some(
        (t) =>
          t.conversationId === conv.id &&
          (active(t) || t.state === "uncertain"),
      )
    )
      throw new ApiError(
        409,
        "conversation_busy",
        "此對話尚有執行中或結果未確認的任務，請先查回狀態。",
      );
    if (list<Task>("task", owner).filter(active).length >= 3)
      throw new ApiError(429, "concurrency_limit", "最多同時執行三項任務。");
    event(
      task,
        localInspiration
        ? "已在後端保存任務，改由工作區靈感搜尋；不是 Hermes。"
        : localImageReview
          ? "已在後端保存任務，改由工作區畫面審查；不是 Hermes，也沒有讀像素。"
          : localSpecRevision
            ? "已在後端保存任務，改由工作區規格修訂；不是 Hermes，也沒有出圖。"
            : localContinue
              ? "已在後端保存任務，改由工作區接續同一件規格；不是 Hermes，也沒有出圖。"
            : "已在後端保存任務，準備提交 Hermes。",
    );
    put("task", owner, task);
    conv.messages.push({
      id: randomUUID(),
      role: "user",
      content: input.input,
      createdAt: now(),
      attachments: input.attachments,
      taskId: task.id,
    });
    conv.assistantMode = mode;
    if (task.researchBundle) conv.researchBundle = task.researchBundle;
    conv.updatedAt = now();
    put("conversation", owner, conv);
    return task;
  });
  if (reserved.id !== task.id) return reserved;
  if (localInspiration)
    return fulfillWorkspaceInspiration(
      owner,
      reserved,
      conversation(owner, reserved.conversationId),
    );
  if (localImageReview)
    return fulfillImageReview(
      owner,
      reserved,
      conversation(owner, reserved.conversationId),
    );
  if (localSpecRevision)
    return fulfillSpecRevision(
      owner,
      reserved,
      conversation(owner, reserved.conversationId),
    );
  if (localContinue)
    return fulfillContinueSameWork(
      owner,
      reserved,
      conversation(owner, reserved.conversationId),
    );
  const controller = new AbortController();
  workers.set(task.id, controller);
  // Requires a persistent Node process (not a serverless invocation).
  void execute(owner, task, conv, controller).finally(() =>
    workers.delete(task.id),
  );
  return task;
}
function canFulfillLocalInspiration(
  credential: string,
  goal: StructuredGoal,
  attachments: string[],
) {
  return (
    credential !== "valid" &&
    goal.requiresInspiration &&
    !goal.directionLocked &&
    !goal.requiresImageReview &&
    attachments.length === 0
  );
}
function canFulfillLocalImageReview(credential: string, goal: StructuredGoal) {
  return credential !== "valid" && goal.requiresImageReview;
}
function workflowForConversation(owner: string, conv: Conversation) {
  return listWorkflows(owner).find(
    (item) =>
      item.projectId === conv.projectId &&
      item.conversationId === conv.id &&
      item.selected !== null &&
      isDirectionBriefPack(item.directionBrief) &&
      !!item.copyId,
  );
}
function canFulfillLocalSpecRevision(
  credential: string,
  input: string,
  conv: Conversation,
  owner: string,
) {
  return (
    credential !== "valid" &&
    isSpecRevisionRequest(userFacingGoalText(input)) &&
    !!workflowForConversation(owner, conv)
  );
}
function canFulfillLocalContinue(
  credential: string,
  input: string,
  conv: Conversation,
  owner: string,
) {
  return (
    credential !== "valid" &&
    isContinueSameWorkRequest(userFacingGoalText(input)) &&
    !!workflowForConversation(owner, conv)
  );
}
function imageAttachmentIds(owner: string, ids: string[]) {
  return ids.filter((id) => material(owner, id).kind === "image");
}
function httpsEventSources(urls: string[]) {
  return urls.filter((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  });
}
function fulfillWorkspaceInspiration(
  owner: string,
  task: Task,
  conv: Conversation,
) {
  const goal = interpretGoal(task.input);
  task.goal = goal;
  const prompt = userFacingGoalText(task.input);
  const found = searchInspiration({
    prompt,
    projectId: conv.projectId,
  });
  const pack = toInspirationPack({
    prompt,
    projectId: conv.projectId,
    items: found.items,
    query: found.query,
  });
  if (!isInspirationSearchPack(pack) || pack.directions.length < 1) {
    task.state = "failed";
    task.error = "工作區靈感沒有可用方向；沒有用假資料補上。";
    task.endedAt = now();
    task.usage.durationMs =
      Date.parse(task.endedAt) - Date.parse(task.createdAt);
    event(task, task.error, "failed");
    return save(owner, task);
  }
  event(task, "已整理工作區靈感方向；不是 Hermes 執行。", "plan");
  event(
    task,
    pack.notice,
    "completed",
    "workspace_search_inspiration",
    pack,
  );
  const last = task.events[task.events.length - 1];
  last.sources = httpsEventSources([
    ...pack.directions.flatMap((item) => item.evidenceUrls),
    ...pack.cards.map((item) => item.sourceUrl),
  ]).slice(0, 20);
  task.output = [
    "已從工作區整理創作方向。",
    pack.notice,
    "這不是 Hermes Agent 執行，也沒有搜尋整個 Instagram 或 Pinterest。",
    goal.requiresDesign
      ? "視覺出圖與 Canva 需要 Hermes 連線後才能做；現在沒有假裝已出圖。"
      : "",
    goal.requiresTamkang
      ? "沒有連到淡江資料源；校園細節標為未驗證。"
      : "",
    "選一個方向後可整理文案規格。",
  ]
    .filter(Boolean)
    .join("\n");
  task.state = "completed";
  task.endedAt = now();
  task.usage.durationMs = Date.parse(task.endedAt) - Date.parse(task.createdAt);
  event(task, "工作區已回傳靈感方向（不是 Hermes 驗證）。");
  if (
    !conv.messages.some((m) => m.taskId === task.id && m.role === "assistant")
  ) {
    conv.messages.push({
      id: randomUUID(),
      role: "assistant",
      content: task.output,
      createdAt: now(),
      taskId: task.id,
      provenance: "workspace",
    });
    conv.updatedAt = now();
    put("conversation", owner, conv);
  }
  return save(owner, task);
}
function fulfillImageReview(
  owner: string,
  task: Task,
  conv: Conversation,
) {
  const goal = interpretGoal(task.input);
  task.goal = goal;
  const images = imageAttachmentIds(owner, task.attachments).map((id) =>
    material(owner, id),
  );
  const titles = images.map((item) => item.title).join("、");
  const twin = simulateFreshmanReactions({
    kind: "poster",
    title: titles,
    copy: [userFacingGoalText(task.input), titles].filter(Boolean).join("\n"),
    visualNotes: "",
  });
  const pack = workspaceImageReview({
    materialIds: images.map((item) => item.id),
    twinPanel: twin,
  });
  if (!isImageReviewPack(pack) || pack.pixelRead !== false) {
    task.state = "failed";
    task.error = "工作區畫面審查沒有誠實標示未讀像素。";
    task.endedAt = now();
    task.usage.durationMs =
      Date.parse(task.endedAt) - Date.parse(task.createdAt);
    event(task, task.error, "failed");
    return save(owner, task);
  }
  event(task, "沒有讀取圖片像素。", "plan");
  event(task, IMAGE_WITHOUT_VISION, "fallback");
  event(
    task,
    pack.notice,
    "completed",
    "workspace_simulate_audience",
    pack,
  );
  task.output = [
    "已附上海報，但沒有讀取像素。",
    pack.notice,
    "這不是 Hermes Agent 執行，也沒有分析構圖、字級或對比。",
    "客群反應是模擬，不是民調。",
    ...pack.suggestions,
  ].join("\n");
  task.state = "completed";
  task.endedAt = now();
  task.usage.durationMs = Date.parse(task.endedAt) - Date.parse(task.createdAt);
  event(task, "工作區已回傳畫面審查草稿（不是 Hermes 驗證）。");
  if (
    !conv.messages.some((m) => m.taskId === task.id && m.role === "assistant")
  ) {
    conv.messages.push({
      id: randomUUID(),
      role: "assistant",
      content: task.output,
      createdAt: now(),
      taskId: task.id,
      provenance: "workspace",
    });
    conv.updatedAt = now();
    put("conversation", owner, conv);
  }
  return save(owner, task);
}
function fulfillSpecRevision(
  owner: string,
  task: Task,
  conv: Conversation,
) {
  const record = workflowForConversation(owner, conv);
  const brief = record?.directionBrief;
  if (!record || !isDirectionBriefPack(brief)) {
    task.state = "failed";
    task.error = "這個對話沒有已選方向，不能修規格。";
    task.endedAt = now();
    task.usage.durationMs =
      Date.parse(task.endedAt) - Date.parse(task.createdAt);
    event(task, task.error, "failed");
    return save(owner, task);
  }
  const revised = applyTypeEnlarge(brief);
  const saved = persistSelectedDirectionDraft(
    owner,
    attachDirectionBrief(owner, record.id, revised),
  );
  const pack = saved.directionBrief;
  if (!isDirectionBriefPack(pack) || pack.rendered !== false) {
    task.state = "failed";
    task.error = "工作區規格修訂沒有誠實標示未出圖。";
    task.endedAt = now();
    task.usage.durationMs =
      Date.parse(task.endedAt) - Date.parse(task.createdAt);
    event(task, task.error, "failed");
    return save(owner, task);
  }
  task.goal = interpretGoal(task.input);
  event(task, "已套用主標加大；不是 Hermes，也沒有出圖。", "plan");
  event(
    task,
    pack.visualNote || pack.notice,
    "completed",
    "workspace_revise_direction_spec",
    pack,
  );
  task.output = [
    "已在同一件規格上套用主標加大。",
    pack.visualNote || pack.notice,
    "這不是 Hermes Agent 執行，不是已出圖，也不是 Canva。",
    pack.revision ? "目前是 V" + pack.revision + "。" : "",
  ]
    .filter(Boolean)
    .join("\n");
  task.state = "completed";
  task.endedAt = now();
  task.usage.durationMs = Date.parse(task.endedAt) - Date.parse(task.createdAt);
  event(task, "工作區已回傳規格修訂（不是 Hermes 驗證）。");
  if (
    !conv.messages.some((m) => m.taskId === task.id && m.role === "assistant")
  ) {
    conv.messages.push({
      id: randomUUID(),
      role: "assistant",
      content: task.output,
      createdAt: now(),
      taskId: task.id,
      provenance: "workspace",
    });
    conv.updatedAt = now();
    put("conversation", owner, conv);
  }
  return save(owner, task);
}
function fulfillContinueSameWork(
  owner: string,
  task: Task,
  conv: Conversation,
) {
  const record = workflowForConversation(owner, conv);
  const pack = record?.directionBrief;
  if (!record || !isDirectionBriefPack(pack)) {
    task.state = "failed";
    task.error = "這個對話沒有已選方向，不能接續同一件作品。";
    task.endedAt = now();
    task.usage.durationMs =
      Date.parse(task.endedAt) - Date.parse(task.createdAt);
    event(task, task.error, "failed");
    return save(owner, task);
  }
  if (pack.rendered !== false) {
    task.state = "failed";
    task.error = "工作區接續沒有誠實標示未出圖。";
    task.endedAt = now();
    task.usage.durationMs =
      Date.parse(task.endedAt) - Date.parse(task.createdAt);
    event(task, task.error, "failed");
    return save(owner, task);
  }
  task.goal = interpretGoal(task.input);
  event(task, "接續同一件規格草稿；不是 Hermes，也沒有出圖。", "plan");
  event(
    task,
    pack.notice,
    "completed",
    "workspace_continue_direction_spec",
    pack,
  );
  task.output = [
    "這是同一件規格草稿。",
    pack.revision ? "目前是 V" + pack.revision + "。" : "",
    "還沒出圖，也不是 Canva 或 Hermes 生成。",
    "請說要改什麼，例如「第二版字放大」。",
  ]
    .filter(Boolean)
    .join("\n");
  task.state = "completed";
  task.endedAt = now();
  task.usage.durationMs = Date.parse(task.endedAt) - Date.parse(task.createdAt);
  event(task, "工作區已帶回同一件規格（不是 Hermes 驗證）。");
  if (
    !conv.messages.some((m) => m.taskId === task.id && m.role === "assistant")
  ) {
    conv.messages.push({
      id: randomUUID(),
      role: "assistant",
      content: task.output,
      createdAt: now(),
      taskId: task.id,
      provenance: "workspace",
    });
    conv.updatedAt = now();
    put("conversation", owner, conv);
  }
  return save(owner, task);
}
async function execute(
  owner: string,
  task: Task,
  conv: Conversation,
  controller: AbortController,
) {
  const overall = setTimeout(
    () => controller.abort(),
    deadline("HERMES_TASK_TIMEOUT_MS", 900000),
  );
  let submitted = false;
  try {
    const connection = await health(owner);
    if (!conv.hermesSessionId && connection.features.session_resources) {
      try {
        const created = await readJSON(
          await upstream(
            "/api/sessions",
            { method: "POST", body: JSON.stringify({ title: conv.title }) },
            controller.signal,
            sessionKeyFor(conv.projectId),
            { role: "general" },
          ),
        );
        const remote =
          created.session_id ??
          created.id ??
          (typeof created.session === "object" &&
          created.session &&
          "id" in created.session
            ? (created.session as { id?: unknown }).id
            : undefined) ??
          (typeof created.data === "object" &&
          created.data &&
          "id" in created.data
            ? (created.data as { id?: unknown }).id
            : undefined);
        if (idSchema.safeParse(remote).success) {
          conv.hermesSessionId = String(remote);
          put("conversation", owner, conv);
        }
        // 會話建立只是加速後續關聯的 best-effort 步驟：遠端未回傳可用識別
        // 時不應整筆任務失敗，後續 /v1/runs 或 chat 流程自帶重試與關聯。
      } catch (error) {
        if (error instanceof ApiError && error.code === "interrupted") throw error;
        event(task, "Hermes 會話預建未成功，將以無會話模式繼續提交。");
      }
    }
    const headers: Record<string, string> = {
      "X-Hermes-Session-Key": sessionKeyFor(conv.projectId),
    };
    if (conv.hermesSessionId)
      headers["X-Hermes-Session-Id"] = conv.hermesSessionId;
    const tokenBudget = budgetFromEnv().tokens;
    const windowed = windowConversationHistory(conv.messages, {
      tokenBudget: historyTokenBudget(tokenBudget),
      summary: conv.historySummary,
    });
    const history = await Promise.all(
      windowed.messages.map(async (m) => ({
        role: m.role,
        content: m.attachments?.length
          ? [
              { type: "text", text: m.content },
              ...(await attachmentParts(owner, m.attachments)),
            ]
          : m.content,
      })),
    );
    const mode = parseAssistantMode(conv.assistantMode);
    const orchestration = prepareOrchestration(
      owner,
      task,
      conv,
      task.budgetMode || "balanced",
    );
    task.goal = orchestration.goal;
    task.plan = orchestration.plan;
    event(task, "已整理目標與可見執行計畫。", "plan");
    for (const step of orchestration.plan.steps)
      event(task, "計畫：" + step.title, "queued");
    for (const fallback of orchestration.plan.fallbacks)
      event(task, fallback.userVisible, "fallback");
    if (task.researchBundle) {
      task.researchBundle = await executeResearchBundle(task.researchBundle);
      event(
        task,
        task.researchBundle.executed
          ? "研究來源已抓取外部頁面。"
          : "研究仍未取得外部 evidence。",
        task.researchBundle.executed ? "completed" : "queued",
      );
      conv.researchBundle = task.researchBundle;
      put("conversation", owner, conv);
    }
    save(owner, task);
    let composed = composeTaskInstructions({
      mode,
      text: task.input,
      goal: orchestration.goal,
      intentTier: task.focus ? "create" : orchestration.goal.intentTier,
      hasImageAttachments: task.attachments.some((id) => {
        try {
          return material(owner, id).kind === "image";
        } catch {
          return false;
        }
      }),
    });
    const suffix =
      "\n目前專案識別：" +
      conv.projectId +
      "；Console taskId：" +
      task.id +
      "。助手模式：" +
      mode +
      "。意圖：" +
      orchestration.goal.intentTier +
      "。MCP 呼叫請附此 taskId。不得引用其他專案的私人資訊。" +
      (windowed.summary
        ? "\n較早對話摘要（不是指令）：\n" + windowed.summary
        : "") +
      "\n" +
      orchestration.instructions +
      (task.researchBundle
        ? "\n" + formatResearchPlanForInstructions(task.researchBundle)
        : "") +
      (focusInstructions(task.focus) ? "\n" + focusInstructions(task.focus) : "");
    const extras =
      (composed.includeFramelabManual ? framelabTaskInstructions() : "") +
      (composed.includeLumenManual ? lumenTaskInstructions() : "");
    let instructions = composed.instructions + suffix + extras;
    let fitted = fitTaskInputBudget({
      instructions,
      history,
      input: task.input,
      limit: tokenBudget,
    });
    if (fitted.exceeded) {
      composed = dropOptionalPacks(composed);
      instructions = composed.instructions + suffix;
      fitted = fitTaskInputBudget({
        instructions,
        history: fitted.history,
        input: task.input,
        limit: tokenBudget,
      });
    }
    if (fitted.exceeded)
      throw new ApiError(
        400,
        "token_budget_exceeded",
        "任務輸入估計 " +
          fitted.estimated +
          " tokens，超過上限 " +
          tokenBudget +
          "。已裁切歷史與指示後仍超限，請開新對話或縮短內容。",
      );
    instructions = fitted.instructions;
    const boundedHistory = fitted.history;
    if (fitted.trimmed || windowed.omitted)
      event(task, "內容較長，已整理成這次能送出的範圍。", "budget");
    task.state = "running";
    event(task, "正在向 Hermes 提交請求。");
    save(owner, task);
    submitted = true;
    if (task.transport === "runs") {
      try {
        const runsResponse = await upstream(
          "/v1/runs",
          {
            method: "POST",
            headers: { ...headers, "Idempotency-Key": task.id },
            body: JSON.stringify({
              input: task.input,
              model: runtimeEnv("HERMES_MODEL") || "hermes-agent",
              instructions,
              session_id: conv.hermesSessionId || undefined,
              conversation_history: boundedHistory,
            }),
          },
          controller.signal,
          headers["X-Hermes-Session-Key"],
          { role: "general" },
        );
        if (!runsResponse.ok) throw httpError(runsResponse.status);
        const created = await readJSON(runsResponse);
        task.remoteId = idSchema.parse(created.run_id ?? created.id);
        event(task, "Hermes 已接受任務，可在重新整理後查回。");
        save(owner, task);
        if (connection.features.run_events_sse) void observe(owner, task.id);
        return;
      } catch (error) {
        // runs 通道不可用（端點未實作、回應形狀不符）時降級為 chat 串流：
        // chat/completions 已驗證可用，不應讓整筆任務失敗。
        if (error instanceof ApiError && error.code === "interrupted") throw error;
        task.transport = "chat";
        event(task, "runs 通道暫時不可用，已改用對話串流繼續執行。");
        save(owner, task);
      }
    }
    const content = task.attachments.length
      ? [
          { type: "text", text: task.input },
          ...(await attachmentParts(owner, task.attachments)),
        ]
      : task.input;
    const response = await upstream(
      "/v1/chat/completions",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: runtimeEnv("HERMES_MODEL") || "hermes-agent",
          stream: true,
          messages: [
            { role: "system", content: instructions },
            ...boundedHistory,
            { role: "user", content },
          ],
        }),
      },
      controller.signal,
      headers["X-Hermes-Session-Key"],
      { role: "general" },
    );
    if (!response.ok) throw httpError(response.status);
    const remoteSession = response.headers.get("X-Hermes-Session-Id");
    if (remoteSession && idSchema.safeParse(remoteSession).success) {
      conv.hermesSessionId = remoteSession;
      put("conversation", owner, conv);
    }
    if (!response.body)
      throw new ApiError(502, "empty_stream", "Hermes 未回傳串流。");
    let complete = false,
      raw = "",
      model: unknown = null,
      rawUsage: unknown = null;
    for await (const frame of frames(
      response.body,
      deadline("HERMES_IDLE_TIMEOUT_MS", 90000),
    )) {
      if (frame.data === "[DONE]") {
        complete = true;
        break;
      }
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(frame.data);
      } catch {
        throw new ApiError(502, "invalid_stream", "Hermes 串流格式錯誤。");
      }
      if (frame.event === "hermes.tool.progress") {
        toolEvent(task, data);
        save(owner, task);
        continue;
      }
      if (data.error)
        throw new ApiError(
          502,
          "agent_error",
          "這次沒有完成。可以稍後再試。",
        );
      const parsed = z
        .object({
          model: z.string().optional(),
          usage: z.unknown().optional(),
          choices: z
            .array(
              z.object({
                delta: z
                  .object({
                    content: z.string().nullable().optional(),
                    tool_calls: z.unknown().optional(),
                  })
                  .optional(),
                finish_reason: z.string().nullable().optional(),
              }),
            )
            .optional(),
        })
        .parse(data);
      model = parsed.model || model;
      rawUsage = parsed.usage || rawUsage;
      for (const choice of parsed.choices || []) {
        if (choice.delta?.tool_calls)
          throw new ApiError(
            502,
            "client_tools_unsupported",
            "這次沒辦法用那個工具。",
          );
        raw += choice.delta?.content || "";
        if (raw.length > 1_000_000)
          throw new ApiError(502, "output_limit", "回應超過工作區限制。");
      }
      task.output = streamPreview(raw);
      task.usage = usage(rawUsage, model, null);
      save(owner, task);
    }
    if (!complete)
      throw new ApiError(
        502,
        "stream_incomplete",
        "串流中斷，尚未收到完成訊號；上游結果待確認。",
      );
    task.output = visibleText(raw);
    if (!task.output.trim() && !hasCompletedToolEvents(task))
      throw new ApiError(502, "empty_output", "Hermes 未產生可顯示的回應。");
    finish(owner, task, "completed");
  } catch (error) {
    const message = studentHermesError(
      error instanceof ApiError
        ? error.message
        : "Hermes 回應格式異常，請查回任務後再決定是否重試。",
      error instanceof ApiError ? error.code : undefined,
    );
    const definite =
      error instanceof ApiError &&
      /^(upstream_|session_invalid|client_tools_unsupported|agent_error|empty_output|empty_stream|invalid_stream|frame_too_large|output_limit|token_budget_exceeded)$/.test(
        error.code,
      );
    finish(
      owner,
      task,
      submitted && !definite ? "uncertain" : "failed",
      message,
    );
  } finally {
    clearTimeout(overall);
  }
}
function toolEvent(task: Task, data: Record<string, unknown>) {
  const name =
    typeof data.tool_name === "string"
      ? data.tool_name
      : typeof data.name === "string"
        ? data.name
        : null;
  if (!name || name === "_thinking") return;
  const rawState =
    typeof data.status === "string"
      ? data.status
      : typeof data.event === "string"
        ? data.event
        : "running";
  let state = rawState.replace(/^tool[._]/, "");
  const result =
    typeof data.result === "string"
      ? redact(data.result).slice(0, 20_000)
      : typeof data.output === "string"
        ? redact(data.output).slice(0, 20_000)
        : data.result && typeof data.result === "object"
          ? data.result
          : data.output && typeof data.output === "object"
            ? data.output
            : null;
  const preview =
    typeof data.preview === "string" ? data.preview : "Hermes 回報工具活動。";
  if (
    (state === "completed" || state === "tool.completed") &&
    !toolEventHasUsableOutput({ result, summary: preview })
  )
    state = "failed";
  event(task, preview, state, name, result);
  const last = task.events[task.events.length - 1];
  last.sources = Array.from(
    new Set(
      (String(result || "") + " " + last.summary).match(
        /https:\/\/[^\s<>"')]+/g,
      ) || [],
    ),
  ).slice(0, 20);
}
const observers = (runtimeTasks.hermesObservers ??= new Set<string>());
async function observe(owner: string, id: string) {
  if (observers.has(id)) return;
  observers.add(id);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deadline("HERMES_TASK_TIMEOUT_MS", 900000),
  );
  try {
    const current = taskFor(owner, id);
    if (!current.remoteId) return;
    let rawOutput = current.output;
    const response = await upstream(
      "/v1/runs/" + current.remoteId + "/events",
      {},
      controller.signal,
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return;
    }
    for await (const frame of frames(
      response.body,
      deadline("HERMES_IDLE_TIMEOUT_MS", 90000),
    )) {
      const task = taskFor(owner, id);
      if (!active(task)) break;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(frame.data);
      } catch {
        continue;
      }
      if (/tool[._](started|completed|failed|progress)/.test(frame.event)) {
        toolEvent(task, { ...data, status: frame.event });
        save(owner, task);
      }
      if (frame.event === "assistant.delta" && typeof data.delta === "string") {
        rawOutput += data.delta;
        task.output = streamPreview(rawOutput).slice(0, 1_000_000);
        save(owner, task);
      }
      if (
        frame.event === "run.completed" ||
        frame.event === "run.failed" ||
        frame.event === "run.cancelled"
      ) {
        await reconcile(owner, id);
        break;
      }
    }
  } catch {
    /* Polling remains authoritative; disconnect never fabricates completion. */
  } finally {
    clearTimeout(timer);
    observers.delete(id);
  }
}
export async function reconcile(owner: string, id: string) {
  let task = taskFor(owner, id);
  if (!active(task)) return task;
  const resume = classifyResume(task, workers.has(id));
  if (task.transport === "chat" || !task.remoteId) {
    if (resume === "unknown")
      return finish(
        owner,
        task,
        "uncertain",
        task.transport === "chat"
          ? resumeNotice("unknown")
          : "任務提交時程序中斷，需確認 Hermes 是否接受；不會重複送出。",
      );
    return task;
  }
  try {
    const remote = await readJSON(await upstream("/v1/runs/" + task.remoteId));
    task = taskFor(owner, id);
    task.observationError = null;
    if (typeof remote.output === "string")
      task.output = visibleText(remote.output);
    task.usage = usage(remote.usage, remote.model, task.usage.durationMs);
    if (
      typeof remote.session_id === "string" &&
      idSchema.safeParse(remote.session_id).success
    ) {
      const conv = conversation(owner, task.conversationId);
      conv.hermesSessionId = remote.session_id;
      put("conversation", owner, conv);
    }
    if (remote.status === "completed")
      return task.output.trim() || hasCompletedToolEvents(task)
        ? finish(owner, task, "completed")
        : finish(
            owner,
            task,
            "failed",
            "Hermes 回報完成，但沒有可讀取的成果。",
          );
    if (remote.status === "failed")
      return finish(
        owner,
        task,
        "failed",
        "這次沒有完成。可以稍後再試。",
      );
    if (remote.status === "cancelled") return finish(owner, task, "cancelled");
    if (remote.status === "stopping") task.state = "stopping";
    else if (
      ["waiting_approval", "waiting_user", "awaiting_approval"].includes(
        String(remote.status),
      )
    )
      task.state = "waiting_user";
    else if (["running", "started", "queued"].includes(String(remote.status))) {
      if (task.state !== "stopping") task.state = "running";
    } else
      throw new ApiError(
        502,
        "unknown_run_status",
        "Hermes 回傳未知任務狀態，尚不能判定完成。",
      );
    if (
      Date.now() - Date.parse(task.createdAt) >
        deadline("HERMES_TASK_TIMEOUT_MS", 900000) &&
      task.state !== "stopping"
    ) {
      if (task.stopSupported) return stop(owner, id);
      task.observationError = "這次等太久了，結果還不確定。";
    }
    void observe(owner, id);
  } catch (error) {
    task.observationError =
      error instanceof ApiError
        ? studentHermesError(error.message, error.code)
        : "查回任務失敗，保留上次已知狀態。";
  }
  return save(owner, task);
}
export async function stop(owner: string, id: string) {
  const task = taskFor(owner, id);
  if (!active(task)) return task;
  if (task.transport === "runs" && task.remoteId && task.stopSupported) {
    await readJSON(
      await upstream("/v1/runs/" + task.remoteId + "/stop", {
        method: "POST",
        body: "{}",
      }),
    );
    task.state = "stopping";
    event(task, "已將停止要求送達 Hermes，等待執行器確認。");
    return save(owner, task);
  }
  workers.get(id)?.abort();
  // Disconnecting HTTP cannot prove that the remote tool stopped.
  return finish(
    owner,
    task,
    "uncertain",
    "已中斷後端連線，但此 Hermes 版本無可驗證的停止介面；工具可能仍在執行。",
  );
}
