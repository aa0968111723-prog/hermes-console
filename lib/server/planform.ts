import { z } from "zod";
import { ApiError, redact, WORKSPACE_OWNER } from "./security";
import { runtimeEnv } from "./credentials";
import { get, put } from "./store";
import { getMcp, githubIsNotMcp, probeMcp } from "./mcp-registry";

const context = {
  taskId: z.string().uuid().optional(),
  toolCallId: z.string().min(1).max(200).optional(),
};

const eventType = z.enum([
  "tea-gathering",
  "meditation",
  "classroom",
  "booth",
  "lecture",
  "workshop",
  "custom",
]);

const objective = z.enum([
  "clear-doors",
  "separate-checkin-payment",
  "reduce-crowding",
  "increase-interaction",
  "easy-to-staff",
  "maximise-capacity",
  "keep-aisle-clear",
  "circulation-first",
  "tidy-visual",
  "checkin-speed",
]);

export const planformSchemas = {
  planform_describe: z.object(context).strict(),
  planform_list_projects: z.object(context).strict(),
  planform_create_project: z
    .object({
      name: z.string().trim().min(1).max(80),
      venuePresetId: z.string().trim().max(80).optional(),
      eventDate: z.string().trim().max(10).optional(),
      ...context,
    })
    .strict(),
  planform_open_project: z
    .object({
      projectId: z.string().trim().min(1).max(120),
      ...context,
    })
    .strict(),
  planform_get_summary: z.object(context).strict(),
  planform_get_venue: z.object(context).strict(),
  planform_get_validation: z.object(context).strict(),
  planform_run_agent: z
    .object({
      utterance: z.string().trim().min(1).max(2000),
      confirm: z.boolean().optional(),
      applyScheme: z.string().trim().max(40).optional(),
      ...context,
    })
    .strict(),
  planform_generate_layout: z
    .object({
      participants: z.number().int().min(1).max(5000).optional(),
      eventType: eventType.optional(),
      objectives: z.array(objective).max(10).optional(),
      utterance: z.string().trim().max(400).optional(),
      ...context,
    })
    .strict(),
  planform_apply_layout: z
    .object({
      candidateId: z.string().trim().min(1).max(40),
      participants: z.number().int().min(1).max(5000).optional(),
      confirm: z.boolean().optional(),
      ...context,
    })
    .strict(),
  planform_confirm_preview: z.object(context).strict(),
  planform_cancel_preview: z.object(context).strict(),
  planform_export_inventory: z.object(context).strict(),
};

export type PlanformToolName = keyof typeof planformSchemas;

export const planformDescriptions: Record<PlanformToolName, string> = {
  planform_describe:
    "讀取 Planform MCP 狀態、目前專案與可用場地模板。場佈工作開始時先呼叫。GitHub 倉庫網址不是 MCP。",
  planform_list_projects: "列出此 MCP 工作階段的場佈專案。",
  planform_create_project:
    "建立場佈專案。venuePresetId 例如 venue:tku-classroom；缺資料時會標記假設，不會猜改場地尺寸。",
  planform_open_project: "開啟既有場佈專案，後續工具都作用在這個專案。",
  planform_get_summary:
    "讀取目前專案摘要：場地、物件、區域、動線、檢查與預覽狀態。",
  planform_get_venue: "讀取實際場地幾何、門、走廊與校正狀態。排版前必讀。",
  planform_get_validation: "重跑幾何檢查：碰撞、門前淨空、走道、無障礙提醒。",
  planform_run_agent:
    "用台灣繁體中文口語執行場佈代理：讀取→規劃→草稿執行→檢查。不會直接改正式專案；套用請再呼叫 planform_confirm_preview。找不到物件時回 unresolved，不可猜最近物件。高風險刪除需 confirm true。",
  planform_generate_layout:
    "依人數與目標產生 A/B/C 場佈方案，含容量、等待、錯誤警告與推薦方案。不套用。",
  planform_apply_layout:
    "把指定方案套進草稿預覽。需 confirm true，再 planform_confirm_preview 才寫入正式專案。",
  planform_confirm_preview: "套用目前草稿。成功後 cancel 不再有效。",
  planform_cancel_preview: "捨棄目前草稿，正式專案不變。",
  planform_export_inventory: "輸出目前場佈的物資／施工清單文字。",
};

export function planformConfigured() {
  return !!runtimeEnv("PLANFORM_MCP_URL");
}

export function isPlanformTool(name: string): name is PlanformToolName {
  return Object.prototype.hasOwnProperty.call(planformSchemas, name);
}

export function planformStatus() {
  const url = runtimeEnv("PLANFORM_MCP_URL");
  if (!url)
    return {
      id: "planform",
      name: "Planform 場佈",
      state: "unconfigured" as const,
      detail:
        "尚未設定 PLANFORM_MCP_URL。GitHub 倉庫網址不是 MCP，請填 Planform 的 /mcp。",
    };
  if (githubIsNotMcp(url))
    return {
      id: "planform",
      name: "Planform 場佈",
      state: "failed" as const,
      detail: "GitHub 網址不是 MCP 端點。請改填 Planform 的 https://…/mcp。",
    };
  return {
    id: "planform",
    name: "Planform 場佈",
    state: "partial" as const,
    detail: runtimeEnv("PLANFORM_MCP_TOKEN")
      ? "已設定端點與服務憑證。Hermes 經 Workspace MCP 呼叫 planform_run_agent；草稿需 confirm_preview 才套用。"
      : "已設定端點。可選 PLANFORM_MCP_TOKEN。Hermes 經工作區 MCP 呼叫 planform_*，不要另連 GitHub。",
  };
}

export async function testPlanformConnection() {
  if (!runtimeEnv("PLANFORM_MCP_URL"))
    throw new ApiError(400, "planform_unconfigured", "請先儲存 Planform MCP 網址。");
  const entry = getMcp("planform");
  if (!entry)
    throw new ApiError(
      400,
      "planform_unconfigured",
      "Planform MCP 尚未出現在核准清單。",
    );
  const probed = await probeMcp(entry);
  return {
    probe: {
      status: probed.status,
      toolsCount: probed.tools.length,
      lastError: probed.lastError,
    },
  };
}

type RpcResult = {
  result?: unknown;
  error?: { message?: string };
};

type StoredSession = {
  id: string;
  sessionId: string;
  endpoint: string;
  updatedAt: string;
};

function parseRpcBody(text: string, contentType: string): RpcResult {
  if (contentType.includes("text/event-stream")) {
    const lines = text.split("\n");
    let last = "";
    for (const line of lines) {
      if (line.startsWith("data:")) last = line.slice(5).trim();
    }
    if (!last)
      throw new ApiError(502, "planform_empty", "Planform MCP 串流沒有回傳資料。");
    return JSON.parse(last) as RpcResult;
  }
  return JSON.parse(text) as RpcResult;
}

function sessionStoreId(taskId?: string) {
  return taskId || "workspace";
}

function loadSession(taskId?: string) {
  const row = get<StoredSession>(
    "planform_session",
    WORKSPACE_OWNER,
    sessionStoreId(taskId),
  );
  if (row?.endpoint === runtimeEnv("PLANFORM_MCP_URL") && row.sessionId)
    return row.sessionId;
  return undefined;
}

function saveSession(sessionId: string, taskId?: string) {
  put("planform_session", WORKSPACE_OWNER, {
    id: sessionStoreId(taskId),
    sessionId,
    endpoint: runtimeEnv("PLANFORM_MCP_URL"),
    updatedAt: new Date().toISOString(),
  } satisfies StoredSession);
}

function clearSession(taskId?: string) {
  put("planform_session", WORKSPACE_OWNER, {
    id: sessionStoreId(taskId),
    sessionId: "",
    endpoint: "",
    updatedAt: new Date().toISOString(),
  } satisfies StoredSession);
}

async function planformRpc(
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
  timeoutMs = 20_000,
) {
  const endpoint = runtimeEnv("PLANFORM_MCP_URL");
  if (!endpoint)
    throw new ApiError(503, "planform_unconfigured", "尚未設定 PLANFORM_MCP_URL。");
  if (githubIsNotMcp(endpoint))
    throw new ApiError(400, "github_is_not_mcp", "GitHub 網址不是 MCP 端點。");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
  };
  const token = runtimeEnv("PLANFORM_MCP_TOKEN");
  if (token) headers.Authorization = "Bearer " + token;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const notify = method.startsWith("notifications/");
  const payload: Record<string, unknown> = {
    jsonrpc: "2.0",
    method,
    params,
  };
  if (!notify) payload.id = Date.now() % 1_000_000;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    redirect: "error",
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const nextSession = response.headers.get("mcp-session-id") || sessionId;
  if (notify) {
    return { result: {}, sessionId: nextSession };
  }
  if (!response.ok)
    throw new ApiError(
      502,
      "planform_http",
      "Planform MCP 回應 " + response.status + "，沒有產生替代成果。",
    );
  const json = parseRpcBody(
    await response.text(),
    response.headers.get("content-type") || "",
  );
  if (json.error)
    throw new ApiError(
      502,
      "planform_rpc",
      redact(json.error.message || "Planform MCP 回傳錯誤。"),
    );
  return { result: json.result, sessionId: nextSession };
}

function remoteArgs(args: Record<string, unknown>) {
  const { taskId, toolCallId, ...rest } = args;
  void taskId;
  void toolCallId;
  return rest;
}

function timeoutFor(name: PlanformToolName) {
  if (name === "planform_run_agent" || name === "planform_generate_layout")
    return 60_000;
  return 20_000;
}

async function ensureSession(taskId?: string) {
  const existing = loadSession(taskId);
  if (existing) return existing;
  const init = await planformRpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "hermes-console", version: "2" },
    },
    undefined,
    10_000,
  );
  await planformRpc(
    "notifications/initialized",
    {},
    init.sessionId,
    5_000,
  ).catch(() => {});
  if (init.sessionId) saveSession(init.sessionId, taskId);
  return init.sessionId;
}

export async function invokePlanform(
  name: PlanformToolName,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
  let sessionId = await ensureSession(taskId);
  let called: { result: unknown; sessionId?: string };
  try {
    called = await planformRpc(
      "tools/call",
      { name, arguments: remoteArgs(args) },
      sessionId,
      timeoutFor(name),
    );
  } catch {
    clearSession(taskId);
    sessionId = await ensureSession(taskId);
    called = await planformRpc(
      "tools/call",
      { name, arguments: remoteArgs(args) },
      sessionId,
      timeoutFor(name),
    );
  }
  if (called.sessionId) saveSession(called.sessionId, taskId);
  const result = called.result;
  if (result && typeof result === "object") {
    const rec = result as {
      structuredContent?: Record<string, unknown>;
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    if (rec.isError) {
      const text = rec.content?.find((c) => c.type === "text")?.text;
      throw new ApiError(
        502,
        "planform_tool_failed",
        redact(text || "Planform 工具執行失敗，沒有產生替代成果。"),
      );
    }
    if (rec.structuredContent && typeof rec.structuredContent === "object")
      return rec.structuredContent;
    const text = rec.content?.find((c) => c.type === "text")?.text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          return parsed as Record<string, unknown>;
      } catch {
        return { text };
      }
    }
  }
  throw new ApiError(502, "planform_empty", "Planform 沒有回傳可用結果。");
}
