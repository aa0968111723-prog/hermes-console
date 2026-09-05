import { z } from "zod";
import { ApiError, WORKSPACE_OWNER, redact } from "./security";
import { get, list, put } from "./store";
import { tamkangConfigured } from "./tamkang";
import { wrapUntrusted } from "./untrusted";

export type McpStatus =
  | "unconfigured"
  | "connected"
  | "partial"
  | "verified"
  | "failed";

export interface McpEntry {
  id: string;
  name: string;
  endpoint: string;
  transport: "streamable-http" | "stdio";
  authMode: "none" | "bearer";
  credentialReference: string | null;
  tools: Array<{ name: string; description: string }>;
  status: McpStatus;
  verifiedAt: string | null;
  lastError: string | null;
  readonly: boolean;
  trustedLevel: "untrusted" | "workspace" | "external";
}

const endpointSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    const local =
      process.env.HERMES_ALLOW_LOOPBACK_HTTP === "true" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (
      ((url.protocol === "https:" || (local && url.protocol === "http:")) &&
        !url.username &&
        !url.password) ||
      false
    );
  }, "MCP 端點必須是受控 HTTPS（契約測試才允許 loopback HTTP）。");

export function githubIsNotMcp(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "github.com" || host === "githubusercontent.com";
  } catch {
    return false;
  }
}

export function seedRegistry(): McpEntry[] {
  const seeded: McpEntry[] = [
    {
      id: "workspace",
      name: "Workspace MCP",
      endpoint: "/api/mcp",
      transport: "streamable-http",
      authMode: "bearer",
      credentialReference: "MCP_BRIDGE_TOKEN",
      tools: [],
      status: process.env.MCP_BRIDGE_TOKEN ? "partial" : "unconfigured",
      verifiedAt: null,
      lastError: null,
      readonly: false,
      trustedLevel: "workspace",
    },
  ];
  if (tamkangConfigured())
    seeded.push({
      id: "tku",
      name: "Tamkang MCP",
      endpoint: process.env.TKU_MCP_URL!,
      transport: "streamable-http",
      authMode: "bearer",
      credentialReference: "TKU_MCP_TOKEN",
      tools: [],
      status: "partial",
      verifiedAt: null,
      lastError: "已設定端點，尚未完成 initialize／tools/list／安全讀取。",
      readonly: true,
      trustedLevel: "external",
    });
  else
    seeded.push({
      id: "tku",
      name: "Tamkang MCP",
      endpoint: "",
      transport: "streamable-http",
      authMode: "bearer",
      credentialReference: "TKU_MCP_TOKEN",
      tools: [],
      status: "unconfigured",
      verifiedAt: null,
      lastError: "尚未設定 TKU_MCP_URL／TKU_MCP_TOKEN。",
      readonly: true,
      trustedLevel: "external",
    });
  const stored = list<McpEntry>("mcp_registry", WORKSPACE_OWNER);
  const merged = new Map(seeded.map((item) => [item.id, item]));
  for (const item of stored) merged.set(item.id, item);
  return Array.from(merged.values());
}

export function registerMcp(input: {
  id: string;
  name: string;
  endpoint: string;
  transport?: McpEntry["transport"];
  authMode?: McpEntry["authMode"];
  credentialReference?: string | null;
  readonly?: boolean;
}) {
  if (githubIsNotMcp(input.endpoint))
    throw new ApiError(
      400,
      "github_is_not_mcp",
      "GitHub 網址不是 MCP 端點；請提供實際 endpoint、transport 與授權。",
    );
  const endpoint = endpointSchema.parse(input.endpoint);
  const entry: McpEntry = {
    id: input.id,
    name: input.name,
    endpoint,
    transport: input.transport || "streamable-http",
    authMode: input.authMode || "bearer",
    credentialReference: input.credentialReference || null,
    tools: [],
    status: "partial",
    verifiedAt: null,
    lastError: "已登記端點，尚未驗證。",
    readonly: input.readonly !== false,
    trustedLevel: "untrusted",
  };
  return put("mcp_registry", WORKSPACE_OWNER, entry);
}

export type JsonRpcResult = {
  method: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export function interpretVerification(steps: {
  initialize: boolean;
  toolsList: boolean;
  safeRead: boolean;
}): McpStatus {
  if (!steps.initialize) return "failed";
  if (steps.safeRead) return "verified";
  if (steps.toolsList) return "partial";
  return "connected";
}

export async function mcpJsonRpc(
  entry: McpEntry,
  method: string,
  params?: unknown,
): Promise<JsonRpcResult> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (entry.authMode === "bearer" && entry.credentialReference) {
      if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(entry.credentialReference))
        return { method, ok: false, error: "憑證參照無效。" };
      const token = process.env[entry.credentialReference];
      if (token) headers.Authorization = "Bearer " + token;
    }
    const response = await fetch(entry.endpoint, {
      method: "POST",
      headers,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: params ?? {},
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { method, ok: false, error: "MCP HTTP " + response.status };
    }
    const data = (await response.json()) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (data.error)
      return {
        method,
        ok: false,
        error: redact(String(data.error.message || "rpc error")),
      };
    return { method, ok: true, result: data.result };
  } catch (error) {
    return {
      method,
      ok: false,
      error: error instanceof Error ? redact(error.message) : "MCP 連線失敗",
    };
  }
}

export async function probeMcp(
  entry: McpEntry,
  rpc: (
    method: string,
    params?: unknown,
  ) => Promise<JsonRpcResult> = (method, params) =>
    mcpJsonRpc(entry, method, params),
) {
  const initialize = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    clientInfo: { name: "hermes-console", version: "1" },
  });
  if (!initialize.ok) {
    const failed = {
      ...entry,
      status: "failed" as const,
      lastError: redact(initialize.error || "initialize 失敗"),
    };
    return put("mcp_registry", WORKSPACE_OWNER, failed);
  }
  const listed = await rpc("tools/list");
  const tools = Array.isArray(
    (listed.result as { tools?: unknown[] } | undefined)?.tools,
  )
    ? (
        (listed.result as { tools: Array<{ name: string; description?: string }> })
          .tools || []
      )
        .slice(0, 100)
        .map((tool) => ({
          name: tool.name,
          description: redact(tool.description || ""),
        }))
    : [];
  const readTool = tools.find((tool) =>
    /list|get|search|read|news|calendar/i.test(tool.name),
  );
  let safeRead = false;
  if (listed.ok && readTool) {
    const called = await rpc("tools/call", {
      name: readTool.name,
      arguments: {},
    });
    safeRead = called.ok;
    if (called.result)
      wrapUntrusted("mcp:" + entry.id, JSON.stringify(called.result).slice(0, 4000));
  }
  const status = interpretVerification({
    initialize: initialize.ok,
    toolsList: listed.ok,
    safeRead,
  });
  return put("mcp_registry", WORKSPACE_OWNER, {
    ...entry,
    tools,
    status,
    verifiedAt: status === "verified" ? new Date().toISOString() : null,
    lastError: listed.ok ? null : redact(listed.error || "tools/list 失敗"),
  });
}

export function getMcp(id: string) {
  return (
    get<McpEntry>("mcp_registry", WORKSPACE_OWNER, id) ||
    seedRegistry().find((item) => item.id === id) ||
    null
  );
}
