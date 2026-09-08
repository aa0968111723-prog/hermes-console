import { z } from "zod";
import { ApiError, redact } from "./security";
import { runtimeEnv } from "./credentials";
import { githubIsNotMcp } from "./mcp-registry";

const context = {
  taskId: z.string().uuid().optional(),
  toolCallId: z.string().min(1).max(200).optional(),
};

const id = z.string().trim().min(1).max(80);

export const duigaoSchemas = {
  duigao_list_tools: z.object(context).strict(),
  duigao_status: z.object(context).strict(),
  duigao_list_templates: z
    .object({ kind: z.enum(["poster", "video"]).optional(), ...context })
    .strict(),
  duigao_list_designs: z.object(context).strict(),
  duigao_get_design: z.object({ designId: id, ...context }).strict(),
  duigao_create_draft: z
    .object({
      name: z.string().trim().min(1).max(80),
      headline: z.string().trim().min(1).max(200),
      body: z.string().trim().max(800).optional(),
      cta: z.string().trim().max(80).optional(),
      format: z.enum(["poster", "ig", "story", "a4", "banner", "reel"]).optional(),
      templateId: z.string().min(1).max(80).optional(),
      operationId: z.string().uuid().optional(),
      ...context,
    })
    .strict(),
  duigao_apply_copy: z
    .object({
      designId: id,
      headline: z.string().trim().max(200).optional(),
      body: z.string().trim().max(800).optional(),
      cta: z.string().trim().max(80).optional(),
      ...context,
    })
    .strict(),
  duigao_add_text: z
    .object({
      designId: id,
      content: z.string().trim().min(1).max(400),
      role: z.enum(["headline", "body", "cta", "note"]).optional(),
      ...context,
    })
    .strict(),
  duigao_list_rooms: z.object(context).strict(),
  duigao_create_room: z
    .object({
      title: z.string().trim().min(1).max(80),
      designId: id.optional(),
      operationId: z.string().uuid().optional(),
      ...context,
    })
    .strict(),
  duigao_list_receipts: z
    .object({ limit: z.number().int().min(1).max(40).optional(), ...context })
    .strict(),
  duigao_call: z
    .object({
      tool: z.string().regex(/^[a-z][a-z0-9_]{1,80}$/),
      arguments: z.record(z.string(), z.unknown()).optional(),
      ...context,
    })
    .strict(),
};

export type DuigaoToolName = keyof typeof duigaoSchemas;

export const duigaoDescriptions: Record<DuigaoToolName, string> = {
  duigao_list_tools: "列出對稿 MCP 工具名稱與讀寫註記。GitHub 倉庫網址不是 MCP。",
  duigao_status: "查回對稿 MCP 狀態與工作室路徑。不是發佈證明。",
  duigao_list_templates: "列出對稿內建海報／影片範本。沒有全網搜尋。",
  duigao_list_designs: "列出對稿 MCP 已保存的真實草稿。",
  duigao_get_design: "讀取一份草稿摘要（尺寸、文字層、工作室路徑）。不含像素。",
  duigao_create_draft:
    "依已整理的標題／內文／CTA 建立對稿海報草稿。回傳工作室路徑，不代表已匯出或發佈。",
  duigao_apply_copy: "把文案套到既有草稿的標題／內文／按鈕層。必須先有 designId。",
  duigao_add_text: "在既有草稿新增一層文字。",
  duigao_list_rooms: "列出對稿活動房摘要。不是 Console 專案。",
  duigao_create_room: "為草稿建立對稿活動房。不會自動上傳海報檔。",
  duigao_list_receipts: "列出對稿 MCP 最近的真實工具呼叫收據。",
  duigao_call: "呼叫任意對稿 MCP 工具（例如 create_draft、apply_copy）。不要把 GitHub 當端點。",
};

export function duigaoConfigured() {
  return !!(runtimeEnv("DUIGAO_MCP_URL") && runtimeEnv("DUIGAO_MCP_TOKEN"));
}

export function isDuigaoTool(name: string): name is DuigaoToolName {
  return Object.prototype.hasOwnProperty.call(duigaoSchemas, name);
}

export function duigaoWriteTool(name: string) {
  return /create_draft|apply_copy|add_text|create_room|_call$/.test(name);
}

export function duigaoStatus() {
  const url = runtimeEnv("DUIGAO_MCP_URL");
  if (!url)
    return {
      id: "duigao",
      name: "對稿",
      state: "unconfigured" as const,
      detail: "尚未設定 DUIGAO_MCP_URL 與 DUIGAO_MCP_TOKEN。GitHub 倉庫網址不是 MCP。",
    };
  if (githubIsNotMcp(url))
    return {
      id: "duigao",
      name: "對稿",
      state: "failed" as const,
      detail: "GitHub 網址不是 MCP 端點。請改填對稿的 /api/mcp。",
    };
  if (!runtimeEnv("DUIGAO_MCP_TOKEN"))
    return {
      id: "duigao",
      name: "對稿",
      state: "awaiting_authorization" as const,
      detail: "已設定端點，尚未提供 DUIGAO_MCP_TOKEN。請從對稿 MCP 頁複製權杖。",
    };
  return {
    id: "duigao",
    name: "對稿",
    state: "partial" as const,
    detail: "已設定端點與權杖，需 initialize／tools/list 驗證後 Hermes 才能呼叫 mcp.duigao 與 duigao_*。",
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
    if (!last) throw new ApiError(502, "duigao_empty", "對稿 MCP 串流沒有回傳資料。");
    return JSON.parse(last) as RpcResult;
  }
  return JSON.parse(text) as RpcResult;
}

async function duigaoRpc(
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
  timeoutMs = 15_000,
) {
  const endpoint = runtimeEnv("DUIGAO_MCP_URL");
  if (!endpoint)
    throw new ApiError(503, "duigao_unconfigured", "尚未設定 DUIGAO_MCP_URL。");
  if (githubIsNotMcp(endpoint))
    throw new ApiError(400, "github_is_not_mcp", "GitHub 網址不是 MCP 端點。");
  const token = runtimeEnv("DUIGAO_MCP_TOKEN");
  if (!token)
    throw new ApiError(503, "duigao_unconfigured", "尚未設定 DUIGAO_MCP_TOKEN。");
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
      "duigao_http",
      "對稿 MCP 回應 " + response.status + "，沒有產生替代成果。",
    );
  const json = parseRpcBody(
    await response.text(),
    response.headers.get("content-type") || "",
  );
  if (json.error)
    throw new ApiError(
      502,
      "duigao_rpc",
      redact(json.error.message || "對稿 MCP 回傳錯誤。"),
    );
  return {
    result: json.result,
    sessionId: response.headers.get("mcp-session-id") || sessionId,
  };
}

function remoteTool(name: DuigaoToolName, args: Record<string, unknown>) {
  if (name === "duigao_list_tools") return { method: "tools/list" as const, arguments: {} };
  if (name === "duigao_call") {
    const tool = String(args.tool || "");
    const forwarded = { ...((args.arguments as Record<string, unknown>) || {}) };
    return { method: "tools/call" as const, name: tool, arguments: forwarded };
  }
  const rest = { ...args };
  delete rest.taskId;
  delete rest.toolCallId;
  return { method: "tools/call" as const, name: name.replace(/^duigao_/, ""), arguments: rest };
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
        "duigao_tool_failed",
        redact(text || "對稿工具執行失敗，沒有產生替代成果。"),
      );
    }
    if (rec.structuredContent && typeof rec.structuredContent === "object") {
      return rec.structuredContent;
    }
    if (Array.isArray(rec.tools)) {
      return { tools: rec.tools };
    }
    const text = rec.content?.find((c) => c.type === "text")?.text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return { text };
      }
    }
  }
  throw new ApiError(502, "duigao_empty", "對稿沒有回傳可用結果。");
}

export async function invokeDuigao(
  name: DuigaoToolName,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const init = await duigaoRpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "hermes-console", version: "2" },
    },
    undefined,
    10_000,
  );
  await duigaoRpc("notifications/initialized", {}, init.sessionId, 5_000).catch(() => {});
  const remote = remoteTool(name, args);
  if (remote.method === "tools/list") {
    const listed = await duigaoRpc("tools/list", {}, init.sessionId, 20_000);
    const tools =
      listed.result && typeof listed.result === "object"
        ? (listed.result as { tools?: Array<{ name: string; description?: string }> }).tools || []
        : [];
    return {
      tools: tools.map((t) => ({ name: t.name, description: redact(t.description || "") })),
      count: tools.length,
      runtimePrefix: "mcp.duigao",
    };
  }
  const called = await duigaoRpc(
    "tools/call",
    { name: remote.name, arguments: remote.arguments },
    init.sessionId,
    60_000,
  );
  return unwrapToolResult(called.result);
}
