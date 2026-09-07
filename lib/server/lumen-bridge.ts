import { ApiError } from "./security";
import { runtimeEnv } from "./credentials";
import { configuredMcp, getMcp } from "./mcp-registry";

export function isLumenTool(name: string) {
  return name.startsWith("lumen_");
}

export function lumenConfigured() {
  return !!(runtimeEnv("LUMEN_MCP_URL") && runtimeEnv("LUMEN_MCP_TOKEN"));
}

export function lumenWorkspaceTools() {
  const entry = getMcp("lumen");
  if (!entry?.enabled || !lumenConfigured()) return [];
  return entry.tools
    .filter((tool) => isLumenTool(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema || { type: "object" },
      annotations: {
        readOnlyHint: tool.annotations?.readOnlyHint ?? /health|get|list/.test(tool.name),
        destructiveHint: tool.annotations?.destructiveHint ?? false,
        idempotentHint: tool.annotations?.idempotentHint ?? true,
        openWorldHint: false,
      },
    }));
}

export async function callLumenThroughWorkspace(
  _owner: string,
  name: string,
  input: unknown,
  _rpcId?: string | number,
) {
  if (!isLumenTool(name))
    throw new ApiError(404, "unknown_tool", "不支援的 MCP 工具。");
  const config = configuredMcp().find((item) => item.id === "lumen");
  if (!config)
    throw new ApiError(
      503,
      "lumen_unconfigured",
      "尚未在連線設定或後端環境變數提供 LUMEN_MCP_URL。",
    );
  const token = runtimeEnv("LUMEN_MCP_TOKEN");
  if (!token || token.length < 32)
    throw new ApiError(503, "mcp_credential_missing", "此 MCP 缺少後端服務憑證。");
  const args =
    input && typeof input === "object" ? (input as { taskId?: string }) : {};
  if (process.env.MCP_REQUIRE_TASK_CONTEXT !== "false" && !args.taskId)
    throw new ApiError(
      403,
      "task_context_required",
      "工具呼叫必須附 Console 的真實 taskId，以套用專案與執行預算。",
    );

  const headers: Record<string, string> = {
    Authorization: "Bearer " + token,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "mcp-protocol-version": "2025-06-18",
  };

  async function rpc(id: number, method: string, params?: unknown) {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers,
      redirect: "error",
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        ...(params ? { params } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const session = response.headers.get("mcp-session-id");
    if (session) headers["mcp-session-id"] = session;
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError(502, "lumen_upstream", "Lumen MCP 回應異常。");
    }
    const payload = (await response.json()) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (payload.error)
      throw new ApiError(502, "lumen_tool_failed", "Lumen 工具執行失敗，沒有產生替代成果。");
    return payload.result;
  }

  await rpc(1, "initialize");
  return rpc(2, "tools/call", { name, arguments: input || {} });
}
