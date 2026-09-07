import { z } from "zod";
import { ApiError, redact } from "./security";
import { runtimeEnv } from "./credentials";
import { githubIsNotMcp } from "./mcp-registry";

const context = {
  taskId: z.string().uuid().optional(),
  toolCallId: z.string().min(1).max(200).optional(),
};

const id = z.string().trim().min(1).max(80);

export const framelabSchemas = {
  framelab_list_tools: z.object(context).strict(),
  framelab_list_projects: z.object(context).strict(),
  framelab_get_project: z.object({ projectId: id, ...context }).strict(),
  framelab_create_project: z
    .object({ name: z.string().trim().min(1).max(120).optional(), fps: z.number().min(1).max(60).optional(), ...context })
    .strict(),
  framelab_create_sample_project: z
    .object({ name: z.string().trim().min(1).max(120).optional(), ...context })
    .strict(),
  framelab_get_timeline: z.object({ timelineId: id, ...context }).strict(),
  framelab_get_frame_window: z
    .object({
      timelineId: id,
      centerFrame: z.number().int().min(0),
      before: z.number().int().min(0).max(24).optional(),
      after: z.number().int().min(0).max(24).optional(),
      ...context,
    })
    .strict(),
  framelab_get_keyframes: z.object({ timelineId: id, ...context }).strict(),
  framelab_get_problem_frames: z.object({ timelineId: id, ...context }).strict(),
  framelab_analyze_consistency: z
    .object({
      timelineId: id,
      startFrame: z.number().int().min(0),
      endFrame: z.number().int().min(0),
      ...context,
    })
    .strict(),
  framelab_suggest_repair: z
    .object({
      timelineId: id,
      startFrame: z.number().int().min(0).optional(),
      endFrame: z.number().int().min(0).optional(),
      sessionId: z.string().trim().min(1).max(80).optional(),
      ...context,
    })
    .strict(),
  framelab_create_inbetween_plan: z
    .object({
      timelineId: id,
      startFrame: z.number().int().min(0),
      endFrame: z.number().int().min(0),
      count: z.number().int().min(1).max(48).optional(),
      curve: z.string().trim().min(1).max(40).optional(),
      intent: z.string().trim().min(1).max(200).optional(),
      ...context,
    })
    .strict(),
  framelab_generate_inbetweens: z
    .object({
      timelineId: id,
      frameA: z.number().int().min(0).optional(),
      frameB: z.number().int().min(0).optional(),
      startFrame: z.number().int().min(0).optional(),
      endFrame: z.number().int().min(0).optional(),
      count: z.number().int().min(1).max(48).optional(),
      provider: z.string().trim().min(1).max(40).optional(),
      confirmed: z.boolean().optional(),
      ...context,
    })
    .strict(),
  framelab_accept_generated_frames: z
    .object({
      candidateId: id,
      confirmed: z.boolean().optional(),
      ...context,
    })
    .strict(),
  framelab_undo: z
    .object({
      projectId: id.optional(),
      frameId: id.optional(),
      revisionId: id.optional(),
      ...context,
    })
    .strict(),
  framelab_get_job: z.object({ jobId: id, ...context }).strict(),
  framelab_get_model_status: z.object(context).strict(),
  framelab_call: z
    .object({
      tool: z.string().regex(/^[a-z][a-z0-9_]{1,80}$/),
      arguments: z.record(z.string(), z.unknown()).optional(),
      confirmed: z.boolean().optional(),
      ...context,
    })
    .strict(),
};

export type FramelabToolName = keyof typeof framelabSchemas;

export const framelabDescriptions: Record<FramelabToolName, string> = {
  framelab_list_tools:
    "列出 FrameLab MCP 工具名稱與讀寫註記。GitHub 倉庫網址不是 MCP。",
  framelab_list_projects: "列出目前權杖可見的 FrameLab 動畫專案。",
  framelab_get_project: "讀取一個 FrameLab 專案與時間軸摘要。",
  framelab_create_project: "建立空白動畫專案與時間軸。預設 24 fps。",
  framelab_create_sample_project: "建立 24 格彈跳球範例時間軸，方便探測後立刻呼叫工具。",
  framelab_get_timeline: "讀取時間軸與影格中繼資料（不含 4K 像素）。",
  framelab_get_frame_window: "讀取中心影格前後的 Frame Graph 視窗。",
  framelab_get_keyframes: "列出 KEY 與 BREAKDOWN 影格。",
  framelab_get_problem_frames: "讀取最近一次一致性分析標為警告／錯誤的影格。",
  framelab_analyze_consistency: "對範圍跑像素一致性，回傳 jobId，需再用 framelab_get_job 輪詢。",
  framelab_suggest_repair: "只建議最小修復窗，不改像素。",
  framelab_create_inbetween_plan: "在兩張關鍵影格之間建立中間張計畫與確認卡，不寫像素。",
  framelab_generate_inbetweens:
    "產生候選中間張。預設 RIFE；provider=linear-blend 只是快速預覽，不是 AI。必須 confirmed=true。不寫入正式時間軸。",
  framelab_accept_generated_frames: "確認後把候選寫入正式時間軸並建立 revision。必須 confirmed=true。",
  framelab_undo: "還原最近一次影格 snapshot。",
  framelab_get_job: "查 FrameLab 工作進度與結果。",
  framelab_get_model_status: "列出 FrameLab 模型適配器與裝置狀態。未載入的模型會回 MODEL_NOT_AVAILABLE。",
  framelab_call:
    "呼叫任意 FrameLab MCP 工具（例如 generate_inbetweens、get_frame_window）。高風險寫入需 confirmed=true。不要把 GitHub 當端點。",
};

export function framelabConfigured() {
  return !!(runtimeEnv("FRAMELAB_MCP_URL") && runtimeEnv("FRAMELAB_MCP_TOKEN"));
}

export function isFramelabTool(name: string): name is FramelabToolName {
  return Object.prototype.hasOwnProperty.call(framelabSchemas, name);
}

export function framelabWriteTool(name: string) {
  return /create_project|create_sample|create_inbetween|generate_inbetweens|accept_generated|_call$|undo$/.test(
    name,
  );
}

export function framelabStatus() {
  const url = runtimeEnv("FRAMELAB_MCP_URL");
  if (!url)
    return {
      id: "framelab",
      name: "FrameLab",
      state: "unconfigured" as const,
      detail: "尚未設定 FRAMELAB_MCP_URL 與 FRAMELAB_MCP_TOKEN。GitHub 倉庫網址不是 MCP。",
    };
  if (githubIsNotMcp(url))
    return {
      id: "framelab",
      name: "FrameLab",
      state: "failed" as const,
      detail: "GitHub 網址不是 MCP 端點。請改填 FrameLab 的 /api/mcp。",
    };
  if (!runtimeEnv("FRAMELAB_MCP_TOKEN"))
    return {
      id: "framelab",
      name: "FrameLab",
      state: "awaiting_authorization" as const,
      detail: "已設定端點，尚未提供 FRAMELAB_MCP_TOKEN。請從 FrameLab 工作室首頁產生權杖。",
    };
  return {
    id: "framelab",
    name: "FrameLab",
    state: "partial" as const,
    detail: "已設定端點與權杖，需 initialize／tools/list 驗證後 Hermes 才能呼叫 mcp.framelab 與 framelab_*。",
  };
}

type RpcResult = {
  result?: unknown;
  error?: { message?: string };
};

function parseRpcBody(text: string, contentType: string): RpcResult {
  if (contentType.includes("text/event-stream")) {
    const lines = text.split("\n");
    let last = "";
    for (const line of lines) {
      if (line.startsWith("data:")) last = line.slice(5).trim();
    }
    if (!last) throw new ApiError(502, "framelab_empty", "FrameLab MCP 串流沒有回傳資料。");
    return JSON.parse(last) as RpcResult;
  }
  return JSON.parse(text) as RpcResult;
}

async function framelabRpc(
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
  timeoutMs = 15_000,
) {
  const endpoint = runtimeEnv("FRAMELAB_MCP_URL");
  if (!endpoint)
    throw new ApiError(503, "framelab_unconfigured", "尚未設定 FRAMELAB_MCP_URL。");
  if (githubIsNotMcp(endpoint))
    throw new ApiError(400, "github_is_not_mcp", "GitHub 網址不是 MCP 端點。");
  const token = runtimeEnv("FRAMELAB_MCP_TOKEN");
  if (!token)
    throw new ApiError(503, "framelab_unconfigured", "尚未設定 FRAMELAB_MCP_TOKEN。");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
    Authorization: "Bearer " + token,
  };
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
  if (notify) {
    return { result: {}, sessionId: response.headers.get("mcp-session-id") || sessionId };
  }
  if (!response.ok)
    throw new ApiError(
      502,
      "framelab_http",
      "FrameLab MCP 回應 " + response.status + "，沒有產生替代成果。",
    );
  const json = parseRpcBody(
    await response.text(),
    response.headers.get("content-type") || "",
  );
  if (json.error)
    throw new ApiError(
      502,
      "framelab_rpc",
      redact(json.error.message || "FrameLab MCP 回傳錯誤。"),
    );
  return {
    result: json.result,
    sessionId: response.headers.get("mcp-session-id") || sessionId,
  };
}

function remoteTool(name: FramelabToolName, args: Record<string, unknown>) {
  if (name === "framelab_list_tools") return { method: "tools/list" as const, arguments: {} };
  if (name === "framelab_call") {
    const tool = String(args.tool || "");
    const forwarded = { ...((args.arguments as Record<string, unknown>) || {}) };
    if (args.confirmed === true) forwarded.confirmed = true;
    return { method: "tools/call" as const, name: tool, arguments: forwarded };
  }
  const rest = { ...args };
  delete rest.taskId;
  delete rest.toolCallId;
  return { method: "tools/call" as const, name: name.replace(/^framelab_/, ""), arguments: rest };
}

/** FrameLab used to wrap executeTool as { ok, data }. Hermes reads top-level fields. */
export function flattenFramelabPayload(sc: Record<string, unknown>): Record<string, unknown> {
  if (!("data" in sc)) return sc;
  if ("projects" in sc || "frames" in sc || "timelineId" in sc) return sc;
  const data = sc.data;
  if (Array.isArray(data)) {
    return { ok: sc.ok !== false, items: data, projects: data, frames: data };
  }
  if (data && typeof data === "object") {
    return { ok: sc.ok !== false, ...(data as Record<string, unknown>) };
  }
  return sc;
}

function unwrapToolResult(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object") {
    const rec = result as {
      structuredContent?: Record<string, unknown>;
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
      tools?: unknown;
    };
    if (rec.isError) {
      const text = rec.content?.find((c) => c.type === "text")?.text;
      throw new ApiError(
        502,
        "framelab_tool_failed",
        redact(text || "FrameLab 工具執行失敗，沒有產生替代成果。"),
      );
    }
    if (rec.structuredContent && typeof rec.structuredContent === "object") {
      return flattenFramelabPayload(rec.structuredContent);
    }
    if (Array.isArray(rec.tools)) {
      return { tools: rec.tools };
    }
    const text = rec.content?.find((c) => c.type === "text")?.text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return flattenFramelabPayload(parsed as Record<string, unknown>);
        }
      } catch {
        return { text };
      }
    }
  }
  throw new ApiError(502, "framelab_empty", "FrameLab 沒有回傳可用結果。");
}

export async function invokeFramelab(
  name: FramelabToolName,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const init = await framelabRpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "hermes-console", version: "2" },
    },
    undefined,
    10_000,
  );
  await framelabRpc("notifications/initialized", {}, init.sessionId, 5_000).catch(() => {});
  const remote = remoteTool(name, args);
  if (remote.method === "tools/list") {
    const listed = await framelabRpc("tools/list", {}, init.sessionId, 20_000);
    const tools =
      listed.result && typeof listed.result === "object"
        ? (listed.result as { tools?: Array<{ name: string; description?: string }> }).tools || []
        : [];
    return {
      tools: tools.map((t) => ({ name: t.name, description: redact(t.description || "") })),
      count: tools.length,
      runtimePrefix: "mcp.framelab",
    };
  }
  const called = await framelabRpc(
    "tools/call",
    { name: remote.name, arguments: remote.arguments },
    init.sessionId,
    60_000,
  );
  return unwrapToolResult(called.result);
}
