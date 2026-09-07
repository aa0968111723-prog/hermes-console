import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Conversation, EMPTY_USAGE, Task, TaskEvent } from "../contracts";
import { get, list, put, transaction } from "./store";
import { ApiError, hash, limited, redact } from "./security";
import {
  creativeInstructions,
  deadline,
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
import { recordTaskUsage } from "./usage";
import { attachmentParts, material } from "./materials";
import { frames } from "./sse";
import {
  parseAssistantMode,
  specialistInstructions,
} from "../assistant-modes";
import {
  formatResearchPlanForInstructions,
  researchBundle,
} from "./research/providers";
import { runtimeEnv } from "./credentials";
import { prepareOrchestration } from "./orchestrator/executor";

const runtimeTasks = globalThis as typeof globalThis & {
  hermesWorkers?: Map<string, AbortController>;
  hermesObservers?: Set<string>;
};
const workers = (runtimeTasks.hermesWorkers ??= new Map<
  string,
  AbortController
>());
const now = () => new Date().toISOString();
export const active = (t: Task) =>
  ["queued", "running", "waiting_user", "stopping"].includes(t.state);
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
export const taskInput = z
  .object({
    conversationId: z.string().uuid(),
    requestKey: z.string().uuid(),
    input: z.string().trim().min(1).max(20_000),
    attachments: z.array(z.string().uuid()).max(4).default([]),
    mode: z.enum(["creative", "research", "admin"]).optional(),
    budgetMode: z.enum(["fast", "balanced", "deep"]).optional(),
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
function finish(
  owner: string,
  task: Task,
  state: Task["state"],
  error: string | null = null,
) {
  task.state = state;
  task.error = error;
  task.endedAt = now();
  task.usage.durationMs = Date.parse(task.endedAt) - Date.parse(task.createdAt);
  event(
    task,
    error ||
      (state === "completed"
        ? "Hermes 已回傳完成結果。"
        : state === "cancelled"
          ? "Hermes 已確認停止。"
          : "任務已結束。"),
  );
  if (state === "completed") {
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
  // Validate actual attachment support before reserving a task or transmitting anything.
  await attachmentParts(owner, input.attachments);
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
  const connection = await health(owner);
  if (connection.credential !== "valid")
    throw new ApiError(503, "hermes_not_ready", connection.message);
  const native =
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
    budgetMode: input.budgetMode || "balanced",
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
    event(task, "已在後端保存任務，準備提交 Hermes。");
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
  const controller = new AbortController();
  workers.set(task.id, controller);
  // Requires a persistent Node process (not a serverless invocation).
  void execute(owner, task, conv, controller).finally(() =>
    workers.delete(task.id),
  );
  return task;
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
      const created = await readJSON(
        await upstream(
          "/api/sessions",
          { method: "POST", body: JSON.stringify({ title: conv.title }) },
          controller.signal,
          sessionKeyFor(conv.projectId),
          { role: "general" },
        ),
      );
      const remote = created.session_id ?? created.id;
      if (!idSchema.safeParse(remote).success)
        throw new ApiError(
          502,
          "session_invalid",
          "Hermes 建立會話後未回傳有效識別。",
        );
      conv.hermesSessionId = String(remote);
      put("conversation", owner, conv);
    }
    const headers: Record<string, string> = {
      "X-Hermes-Session-Key": sessionKeyFor(conv.projectId),
    };
    if (conv.hermesSessionId)
      headers["X-Hermes-Session-Id"] = conv.hermesSessionId;
    const history = await Promise.all(
      conv.messages.slice(0, -1).map(async (m) => ({
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
    const researchPlan = task.researchBundle;
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
    save(owner, task);
    const instructions =
      (specialistInstructions(mode) || creativeInstructions) +
      "\n目前專案識別：" +
      conv.projectId +
      "；Console taskId：" +
      task.id +
      "。助手模式：" +
      mode +
      "。MCP 呼叫請附此 taskId。不得引用其他專案的私人資訊。" +
      "\n" +
      orchestration.instructions +
      (researchPlan ? "\n" + formatResearchPlanForInstructions(researchPlan) : "");
    task.state = "running";
    event(task, "正在向 Hermes 提交請求。");
    save(owner, task);
    submitted = true;
    if (task.transport === "runs") {
      const response = await readJSON(
        await upstream(
          "/v1/runs",
          {
            method: "POST",
            headers: { ...headers, "Idempotency-Key": task.id },
            body: JSON.stringify({
              input: task.input,
              model: runtimeEnv("HERMES_MODEL") || "hermes-agent",
              instructions,
              session_id: conv.hermesSessionId || undefined,
              conversation_history: history,
            }),
          },
          controller.signal,
          headers["X-Hermes-Session-Key"],
          { role: "general" },
        ),
      );
      task.remoteId = idSchema.parse(response.run_id);
      event(task, "Hermes 已接受任務，可在重新整理後查回。");
      save(owner, task);
      if (connection.features.run_events_sse) void observe(owner, task.id);
      return;
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
            ...history,
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
          "Hermes 回報執行失敗，請檢查 Agent／工具授權。",
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
            "上游要求客戶端執行工具；此工作區只接受由 Hermes 執行的工具，已停止。",
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
    if (!task.output.trim())
      throw new ApiError(502, "empty_output", "Hermes 未產生可顯示的回應。");
    finish(owner, task, "completed");
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : "Hermes 回應格式異常，請查回任務後再決定是否重试。";
    const definite =
      error instanceof ApiError &&
      /^(upstream_|session_invalid|client_tools_unsupported|agent_error|empty_output)/.test(
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
  const state = rawState.replace(/^tool[._]/, "");
  const result =
    typeof data.result === "string"
      ? redact(data.result).slice(0, 20_000)
      : typeof data.output === "string"
        ? redact(data.output).slice(0, 20_000)
        : null;
  event(
    task,
    typeof data.preview === "string" ? data.preview : "Hermes 回報工具活動。",
    state,
    name,
    result,
  );
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
  if (task.transport === "chat") {
    if (!workers.has(id))
      return finish(
        owner,
        task,
        "uncertain",
        "Console 程序曾中斷，無法確認串流上游結果；不會自動重送。",
      );
    return task;
  }
  if (!task.remoteId) {
    if (!workers.has(id))
      return finish(
        owner,
        task,
        "uncertain",
        "任務提交時程序中斷，需確認 Hermes 是否接受；不會重複送出。",
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
      return task.output.trim()
        ? finish(owner, task, "completed")
        : finish(
            owner,
            task,
            "failed",
            "Hermes 回報完成，但沒有可讀取的成果；請檢查原始會話。",
          );
    if (remote.status === "failed")
      return finish(
        owner,
        task,
        "failed",
        "Hermes 回報任務失敗；請檢查工具授權與服務日誌。",
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
      task.observationError =
        "任務超過整體期限，但此版本不能確認停止；請至 Hermes 檢查。";
    }
    void observe(owner, id);
  } catch (error) {
    task.observationError =
      error instanceof ApiError
        ? error.message
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
