import { z } from "zod";
import { ApiError, redact } from "./security";
import { runtimeEnv } from "./credentials";
import { githubIsNotMcp } from "./mcp-registry";

const context = {
  taskId: z.string().uuid().optional(),
  toolCallId: z.string().min(1).max(200).optional(),
};

export const xunheSchemas = {
  xunhe_research: z
    .object({
      goal: z.string().trim().min(4).max(2000),
      agentId: z.string().trim().min(1).max(80).optional(),
      ...context,
    })
    .strict(),
  xunhe_get_task: z
    .object({
      xunheTaskId: z.string().trim().min(8).max(80),
      ...context,
    })
    .strict(),
  xunhe_get_report: z
    .object({
      xunheTaskId: z.string().trim().min(8).max(80),
      ...context,
    })
    .strict(),
  xunhe_list_tasks: z
    .object({
      limit: z.number().int().min(1).max(40).optional(),
      ...context,
    })
    .strict(),
  xunhe_list_agents: z.object(context).strict(),
};

export type XunheToolName = keyof typeof xunheSchemas;

export const xunheDescriptions: Record<XunheToolName, string> = {
  xunhe_research:
    "把自然語言情報目標交給訊核主控代理：拆解、搜尋最新資料、核對來源並產出有引用的結果。回傳 xunheTaskId，請再用 xunhe_get_task 查進度。不會用模型記憶冒充即時資料。",
  xunhe_get_task:
    "查回訊核任務狀態、來源、矛盾與報告摘要。xunheTaskId 是 xunhe_research 回傳的識別，不是 Console 的 taskId。",
  xunhe_get_report:
    "讀取已完成或部分完成的訊核報告與引用來源。尚未完成時會說明目前階段，不會偽造報告。",
  xunhe_list_tasks: "列出最近的訊核情報任務與狀態。",
  xunhe_list_agents: "列出訊核可調度的情報代理名稱、角色與版本。",
};

export function xunheConfigured() {
  return !!runtimeEnv("XUNHE_MCP_URL");
}

export function isXunheTool(name: string): name is XunheToolName {
  return Object.prototype.hasOwnProperty.call(xunheSchemas, name);
}

export function xunheStatus() {
  const url = runtimeEnv("XUNHE_MCP_URL");
  if (!url)
    return {
      id: "xunhe",
      name: "訊核即時情報",
      state: "unconfigured" as const,
      detail: "尚未設定 XUNHE_MCP_URL。GitHub 倉庫網址不是 MCP。",
    };
  if (githubIsNotMcp(url))
    return {
      id: "xunhe",
      name: "訊核即時情報",
      state: "failed" as const,
      detail: "GitHub 網址不是 MCP 端點。請改填訊核 /mcp。",
    };
  return {
    id: "xunhe",
    name: "訊核即時情報",
    state: "partial" as const,
    detail: runtimeEnv("XUNHE_MCP_TOKEN")
      ? "已設定端點與服務憑證，需 initialize／tools/list 驗證後 Hermes 才能呼叫。"
      : "已設定端點。可選 XUNHE_MCP_TOKEN；驗證成功後 Hermes 可經工作區 MCP 呼叫訊核工具。",
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
    if (!last) throw new ApiError(502, "xunhe_empty", "訊核 MCP 串流沒有回傳資料。");
    return JSON.parse(last) as RpcResult;
  }
  return JSON.parse(text) as RpcResult;
}

async function xunheRpc(
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
  timeoutMs = 15_000,
) {
  const endpoint = runtimeEnv("XUNHE_MCP_URL");
  if (!endpoint)
    throw new ApiError(503, "xunhe_unconfigured", "尚未設定 XUNHE_MCP_URL。");
  if (githubIsNotMcp(endpoint))
    throw new ApiError(400, "github_is_not_mcp", "GitHub 網址不是 MCP 端點。");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
  };
  const token = runtimeEnv("XUNHE_MCP_TOKEN");
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
  if (notify) {
    return { result: {}, sessionId: response.headers.get("mcp-session-id") || sessionId };
  }
  if (!response.ok)
    throw new ApiError(
      502,
      "xunhe_http",
      "訊核 MCP 回應 " + response.status + "，沒有產生替代成果。",
    );
  const json = parseRpcBody(
    await response.text(),
    response.headers.get("content-type") || "",
  );
  if (json.error)
    throw new ApiError(
      502,
      "xunhe_rpc",
      redact(json.error.message || "訊核 MCP 回傳錯誤。"),
    );
  return {
    result: json.result,
    sessionId: response.headers.get("mcp-session-id") || sessionId,
  };
}

function remoteArgs(name: XunheToolName, args: Record<string, unknown>) {
  if (name === "xunhe_research")
    return { goal: args.goal, agentId: args.agentId };
  if (name === "xunhe_get_task" || name === "xunhe_get_report")
    return { taskId: args.xunheTaskId };
  if (name === "xunhe_list_tasks") return { limit: args.limit };
  return {};
}

export async function invokeXunhe(
  name: XunheToolName,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const init = await xunheRpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "hermes-console", version: "2" },
    },
    undefined,
    10_000,
  );
  await xunheRpc(
    "notifications/initialized",
    {},
    init.sessionId,
    5_000,
  ).catch(() => {});
  const called = await xunheRpc(
    "tools/call",
    { name, arguments: remoteArgs(name, args) },
    init.sessionId,
    60_000,
  );
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
        "xunhe_tool_failed",
        redact(text || "訊核工具執行失敗，沒有產生替代成果。"),
      );
    }
    if (rec.structuredContent && typeof rec.structuredContent === "object") {
      const data = { ...rec.structuredContent };
      if (typeof data.taskId === "string" && !data.xunheTaskId) data.xunheTaskId = data.taskId;
      return data;
    }
    const text = rec.content?.find((c) => c.type === "text")?.text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const data = parsed as Record<string, unknown>;
          if (typeof data.taskId === "string" && !data.xunheTaskId) data.xunheTaskId = data.taskId;
          return data;
        }
      } catch {
        return { text };
      }
    }
  }
  throw new ApiError(502, "xunhe_empty", "訊核沒有回傳可用結果。");
}
