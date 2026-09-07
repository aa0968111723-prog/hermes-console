import { ApiError } from "./security";
import { runtimeEnv } from "./credentials";
import { getMcp } from "./mcp-registry";

export const GALLEY_TOOLS = [
  "galley_capability",
  "galley_research",
  "galley_intel",
] as const;

export function galleyConfigured() {
  return !!(runtimeEnv("GALLEY_MCP_URL") && runtimeEnv("GALLEY_MCP_TOKEN"));
}

export function galleyStatus(input?: {
  reachable?: boolean;
  tools?: Array<{ name: string }>;
  verifiedRead?: boolean;
}) {
  if (input?.reachable === false)
    return {
      id: "galley",
      name: "GALLEY 研究情報",
      state: (galleyConfigured() ? "failed" : "unconfigured") as
        | "failed"
        | "unconfigured",
      detail: galleyConfigured()
        ? "GALLEY MCP 離線；未執行研究，不得改用記憶填空。"
        : "尚未在連線設定或後端環境變數提供 GALLEY_MCP_URL 與 GALLEY_MCP_TOKEN。",
      tools: GALLEY_TOOLS,
      fallback: null,
    };
  if (!galleyConfigured())
    return {
      id: "galley",
      name: "GALLEY 研究情報",
      state: "unconfigured" as const,
      detail:
        "尚未在連線設定或後端環境變數提供 GALLEY_MCP_URL 與 GALLEY_MCP_TOKEN。GitHub 網址不是 MCP 端點。",
      tools: GALLEY_TOOLS,
      fallback: null,
    };
  if (input?.verifiedRead)
    return {
      id: "galley",
      name: "GALLEY 研究情報",
      state: "available" as const,
      detail: "已通過安全讀取工具驗證。",
      tools: (input.tools || []).map((t) => t.name),
      fallback: null,
    };
  if (input?.tools?.length)
    return {
      id: "galley",
      name: "GALLEY 研究情報",
      state: "partial" as const,
      detail: "已列出工具，尚未完成安全讀取驗證。",
      tools: input.tools.map((t) => t.name),
      fallback: null,
    };
  return {
    id: "galley",
    name: "GALLEY 研究情報",
    state: "awaiting_authorization" as const,
    detail: "已設定端點，尚未完成 initialize／tools/list。",
    tools: GALLEY_TOOLS,
    fallback: null,
  };
}

function endpoint() {
  const value = runtimeEnv("GALLEY_MCP_URL");
  const token = runtimeEnv("GALLEY_MCP_TOKEN");
  if (!value || !token)
    throw new ApiError(
      503,
      "galley_unconfigured",
      "尚未設定 GALLEY_MCP_URL 與 GALLEY_MCP_TOKEN。GitHub 網址不是 MCP 端點。",
    );
  if (token.length < 32)
    throw new ApiError(
      503,
      "galley_token_invalid",
      "GALLEY MCP 權杖至少需要 32 個字元。",
    );
  return { value, token };
}

async function readJsonRpc(response: Response) {
  const type = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!raw)
    throw new ApiError(502, "galley_empty", "GALLEY MCP 沒有回傳內容。");
  if (type.includes("text/event-stream")) {
    const line = raw
      .split("\n")
      .map((item) => item.trim())
      .find((item) => item.startsWith("data:"));
    if (!line)
      throw new ApiError(502, "galley_invalid", "GALLEY MCP SSE 沒有 data。");
    try {
      return JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
    } catch {
      throw new ApiError(502, "galley_invalid", "GALLEY MCP 回應不是有效 JSON。");
    }
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ApiError(502, "galley_invalid", "GALLEY MCP 回應不是有效 JSON。");
  }
}

export async function callGalleyTool(
  name: (typeof GALLEY_TOOLS)[number],
  args: Record<string, unknown>,
) {
  const { value, token } = endpoint();
  const { taskId, toolCallId, ...forward } = args;
  void taskId;
  void toolCallId;
  let response: Response;
  try {
    response = await fetch(value, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer " + token,
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: forward },
      }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    throw new ApiError(
      504,
      "galley_unreachable",
      "無法連線 GALLEY MCP；沒有產生備援研究。",
    );
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => undefined);
    throw new ApiError(
      502,
      "galley_unauthorized",
      "GALLEY MCP 拒絕憑證。請核對 GALLEY_MCP_TOKEN。",
    );
  }
  const payload = await readJsonRpc(response);
  if (payload.error && typeof payload.error === "object") {
    throw new ApiError(
      502,
      "galley_rpc_error",
      "GALLEY MCP 回傳協定錯誤；未產生研究。",
    );
  }
  const result = payload.result;
  if (!result || typeof result !== "object")
    throw new ApiError(502, "galley_invalid", "GALLEY MCP 沒有工具結果。");
  const envelope = result as {
    isError?: boolean;
    structuredContent?: { result?: unknown };
    content?: Array<{ type?: string; text?: string }>;
  };
  if (envelope.isError)
    throw new ApiError(
      502,
      "galley_tool_failed",
      "GALLEY 研究失敗，沒有替代成果。",
    );
  if (
    envelope.structuredContent &&
    envelope.structuredContent.result &&
    typeof envelope.structuredContent.result === "object"
  ) {
    return envelope.structuredContent.result as Record<string, unknown>;
  }
  const text = envelope.content?.find((item) => item.type === "text")?.text;
  if (!text)
    throw new ApiError(502, "galley_invalid", "GALLEY MCP 沒有文字結果。");
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object")
      return parsed as Record<string, unknown>;
  } catch {
    /* keep text */
  }
  return { text };
}

export function liveGalleyStatus() {
  const entry = getMcp("galley");
  if (!entry)
    return galleyStatus({
      reachable: runtimeEnv("GALLEY_MCP_URL") ? false : undefined,
    });
  return galleyStatus({
    reachable: entry.status === "failed" ? false : undefined,
    tools: entry.tools,
    verifiedRead: entry.status === "verified",
  });
}
