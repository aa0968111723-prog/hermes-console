import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { validateSsrfSafeUrl, ApiError } from "../security.ts";

export interface McpClientOptions {
  clientName?: string;
  clientVersion?: string;
  timeoutMs?: number;
  token?: string;
  allowLoopback?: boolean;
}

export interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export type McpClientInstance = {
  client: Client;
  transport: StreamableHTTPClientTransport;
  listTools: () => Promise<DiscoveredTool[]>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

/**
 * 建立具備 SSRF 防護與安全傳輸的標準 MCP 客戶端實例
 */
export async function createMcpClient(
  serverUrl: string,
  options: McpClientOptions = {}
): Promise<McpClientInstance> {
  const allowLoopback =
    options.allowLoopback ??
    (process.env.HERMES_ALLOW_LOOPBACK_HTTP === "true" || process.env.NODE_ENV !== "production");

  const ssrf = validateSsrfSafeUrl(serverUrl, allowLoopback);
  if (!ssrf.safe) {
    throw new ApiError(400, "ssrf_rejected", `MCP 連線網址遭阻擋: ${ssrf.reason}`);
  }

  const url = new URL(serverUrl);
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream"
  };

  const token = options.token || process.env.MCP_BRIDGE_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers
    }
  });

  const client = new Client({
    name: options.clientName || "hermes-creative-os-client",
    version: options.clientVersion || "1.0.0"
  });

  await client.connect(transport);

  return {
    client,
    transport,
    listTools: async () => {
      const res = await client.listTools();
      return (res.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }));
    },
    callTool: async (name: string, args: Record<string, unknown> = {}) => {
      const res = await client.callTool({
        name,
        arguments: args
      });
      // 解析標準 MCP 回傳內容
      if (Array.isArray(res.content) && res.content.length > 0) {
        const first = res.content[0];
        if (first && typeof first === "object" && "text" in first) {
          try {
            return JSON.parse(first.text as string);
          } catch {
            return first.text;
          }
        }
      }
      return res;
    },
    close: async () => {
      try {
        await client.close();
      } catch {
        // 忽略關閉時的靜態中斷
      }
    }
  };
}

/**
 * 快速執行遠端 MCP 工具調用（自動處理連線與生命週期釋放）
 */
export async function callRemoteMcpToolViaSdk(
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown> = {},
  options: McpClientOptions = {}
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  let mcpInstance: McpClientInstance | null = null;
  try {
    mcpInstance = await createMcpClient(serverUrl, options);
    const timeoutMs = options.timeoutMs || 5000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`MCP 工具調用逾時 (${timeoutMs}ms)`)), timeoutMs)
    );

    const callPromise = mcpInstance.callTool(toolName, args);
    const res = await Promise.race([callPromise, timeoutPromise]);
    return { success: true, result: res };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  } finally {
    if (mcpInstance) {
      await mcpInstance.close().catch(() => {});
    }
  }
}

/**
 * 動態發現遠端 MCP 伺服器支援之工具清單
 */
export async function discoverRemoteMcpTools(
  serverUrl: string,
  options: McpClientOptions = {}
): Promise<{ success: boolean; tools: DiscoveredTool[]; error?: string }> {
  let mcpInstance: McpClientInstance | null = null;
  try {
    mcpInstance = await createMcpClient(serverUrl, options);
    const tools = await mcpInstance.listTools();
    return { success: true, tools };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, tools: [], error: message };
  } finally {
    if (mcpInstance) {
      await mcpInstance.close().catch(() => {});
    }
  }
}
