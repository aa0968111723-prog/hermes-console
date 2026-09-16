import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  ApiError,
  WORKSPACE_OWNER,
  assertSafeServiceUrl,
  redact,
} from "./security";
import { get, list, put } from "./store";
import { safeMcpFetch } from "./mcp-network";
import { runtimeEnv } from "./credentials";

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
  tools: Array<{
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    annotations?: {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
    };
  }>;
  status: McpStatus;
  verifiedAt: string | null;
  lastError: string | null;
  readonly: boolean;
  trustedLevel: "untrusted" | "workspace" | "external";
  enabled: boolean;
  serverInfo?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
}
const definition = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{2,40}$/),
    name: z.string().min(1).max(80),
    endpoint: z.string().url(),
    credentialReference: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{2,80}$/)
      .nullable()
      .default(null),
    readonly: z.boolean().default(true),
  })
  .strict();
function validateEndpoint(value: string) {
  const url = new URL(value);
  const local =
    process.env.HERMES_ALLOW_LOOPBACK_HTTP === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    githubIsNotMcp(value)
  )
    throw new ApiError(
      503,
      "invalid_mcp_target",
      "後端 MCP 目標需為無帳密與查詢參數的受控 HTTPS 端點。",
    );
  assertSafeServiceUrl(value, "mcp");
  return url.toString();
}
export function githubIsNotMcp(value: string) {
  try {
    return (
      /^(www\.)?github(com|usercontent)?\.com$/.test(new URL(value).hostname) ||
      [
        "github.com",
        "raw.githubusercontent.com",
        "githubusercontent.com",
      ].includes(new URL(value).hostname)
    );
  } catch {
    return false;
  }
}
export function configuredMcp() {
  let raw: unknown;
  try {
    raw = JSON.parse(runtimeEnv("CONSOLE_MCP_SERVERS_JSON") || "[]");
  } catch {
    throw new ApiError(
      503,
      "mcp_config_invalid",
      "後端 MCP 核准清單格式錯誤。",
    );
  }
  const parsed = z.array(definition).max(30).safeParse(raw);
  if (!parsed.success)
    throw new ApiError(
      503,
      "mcp_config_invalid",
      "後端 MCP 核准清單格式錯誤。",
    );
  const configs = parsed.data;
  if (!configs.some((c) => c.id === "tku") && runtimeEnv("TKU_MCP_URL"))
    configs.push({
      id: "tku",
      name: "Tamkang MCP",
      endpoint: runtimeEnv("TKU_MCP_URL"),
      credentialReference: "TKU_MCP_TOKEN",
      readonly: true,
    });
  if (!configs.some((c) => c.id === "galley") && runtimeEnv("GALLEY_MCP_URL"))
    configs.push({
      id: "galley",
      name: "GALLEY 研究情報",
      endpoint: runtimeEnv("GALLEY_MCP_URL"),
      credentialReference: "GALLEY_MCP_TOKEN",
      readonly: false,
    });
  if (!configs.some((c) => c.id === "xunhe") && runtimeEnv("XUNHE_MCP_URL"))
    configs.push({
      id: "xunhe",
      name: "訊核即時情報",
      endpoint: runtimeEnv("XUNHE_MCP_URL"),
      credentialReference: runtimeEnv("XUNHE_MCP_TOKEN") ? "XUNHE_MCP_TOKEN" : null,
      readonly: false,
    });
  if (!configs.some((c) => c.id === "planform") && runtimeEnv("PLANFORM_MCP_URL"))
    configs.push({
      id: "planform",
      name: "Planform 場佈",
      endpoint: runtimeEnv("PLANFORM_MCP_URL"),
      credentialReference: runtimeEnv("PLANFORM_MCP_TOKEN")
        ? "PLANFORM_MCP_TOKEN"
        : null,
      readonly: false,
    });
  if (!configs.some((c) => c.id === "atlas") && runtimeEnv("ATLAS_MCP_URL"))
    configs.push({
      id: "atlas",
      name: "場圖 Atlas",
      endpoint: runtimeEnv("ATLAS_MCP_URL"),
      credentialReference: "ATLAS_MCP_TOKEN",
      readonly: false,
    });
  if (!configs.some((c) => c.id === "lumen") && runtimeEnv("LUMEN_MCP_URL"))
    configs.push({
      id: "lumen",
      name: "Lumen 創作台",
      endpoint: runtimeEnv("LUMEN_MCP_URL"),
      credentialReference: "LUMEN_MCP_TOKEN",
      readonly: false,
    });
  if (!configs.some((c) => c.id === "framelab") && runtimeEnv("FRAMELAB_MCP_URL"))
    configs.push({
      id: "framelab",
      name: "FrameLab",
      endpoint: runtimeEnv("FRAMELAB_MCP_URL"),
      credentialReference: "FRAMELAB_MCP_TOKEN",
      readonly: false,
    });
  if (!configs.some((c) => c.id === "duigao") && runtimeEnv("DUIGAO_MCP_URL"))
    configs.push({
      id: "duigao",
      name: "對稿工作室",
      endpoint: runtimeEnv("DUIGAO_MCP_URL"),
      credentialReference: "DUIGAO_MCP_TOKEN",
      readonly: false,
    });
  if (
    configs.some((c) => c.id === "workspace") ||
    new Set(configs.map((c) => c.id)).size !== configs.length
  )
    throw new ApiError(
      503,
      "mcp_config_invalid",
      "MCP 清單識別重複或使用保留名稱。",
    );
  return configs.map((c) => ({ ...c, endpoint: validateEndpoint(c.endpoint) }));
}
export function atlasStatus() {
  const url = runtimeEnv("ATLAS_MCP_URL");
  if (!url)
    return {
      id: "atlas",
      name: "場圖 Atlas",
      state: "unconfigured" as const,
      detail: "尚未設定 ATLAS_MCP_URL 與 ATLAS_MCP_TOKEN。GitHub 倉庫網址不是 MCP。",
    };
  if (githubIsNotMcp(url))
    return {
      id: "atlas",
      name: "場圖 Atlas",
      state: "failed" as const,
      detail: "GitHub 網址不是 MCP 端點。請改填場圖 /api/mcp。",
    };
  if (!runtimeEnv("ATLAS_MCP_TOKEN"))
    return {
      id: "atlas",
      name: "場圖 Atlas",
      state: "unconfigured" as const,
      detail: "尚未提供 ATLAS_MCP_TOKEN，不能標成已連線。",
    };
  return honestConfiguredStatus("atlas", {
    id: "atlas",
    name: "場圖 Atlas",
    state: "awaiting_authorization" as const,
    detail: "已設定端點與權杖，尚未完成 initialize／tools/list。",
  });
}
function controlled(id: string) {
  const config = configuredMcp().find((c) => c.id === id);
  if (!config)
    throw new ApiError(
      403,
      "mcp_target_not_allowed",
      "此 MCP 尚未由後端核准端點與憑證配對。",
    );
  return config;
}
export function seedRegistry(): McpEntry[] {
  const workspace: McpEntry = {
    id: "workspace",
    name: "Workspace MCP",
    endpoint: "/api/mcp",
    transport: "streamable-http",
    authMode: "bearer",
    credentialReference: "MCP_BRIDGE_TOKEN",
    tools: [],
    status: "unconfigured",
    verifiedAt: null,
    lastError: runtimeEnv("MCP_BRIDGE_TOKEN")
      ? "已設定服務憑證，尚未由 Hermes 完成連線驗證。"
      : "尚未設定 MCP_BRIDGE_TOKEN。",
    readonly: false,
    trustedLevel: "workspace",
    enabled: true,
  };
  const configs = configuredMcp();
  const entries = configs.map((config): McpEntry => {
    const old = get<McpEntry>("mcp_registry", WORKSPACE_OWNER, config.id);
    const matches =
      old?.endpoint === config.endpoint &&
      old.credentialReference === config.credentialReference;
    return {
      ...config,
      transport: "streamable-http",
      authMode: config.credentialReference ? "bearer" : "none",
      tools: old?.enabled === false ? [] : matches ? old.tools : [],
      enabled: old?.enabled !== false,
      status:
        old?.enabled === false
          ? "unconfigured"
          : matches
            ? old.status === "verified"
              ? "partial"
              : old.status
            : "unconfigured",
      verifiedAt: matches ? old.verifiedAt : null,
      lastError:
        old?.enabled === false
          ? "此 MCP 已停用。"
          : matches
            ? old.lastError
            : "後端已配置，尚未驗證工具清單。",
      trustedLevel: "external",
    };
  });
  // Preserve old registry metadata, but never retain authority from a client-chosen target.
  for (const old of list<McpEntry>("mcp_registry", WORKSPACE_OWNER))
    if (old.id !== "workspace" && !configs.some((c) => c.id === old.id))
      entries.push({
        ...old,
        endpoint: "",
        credentialReference: null,
        tools: [],
        status: "unconfigured",
        verifiedAt: null,
        lastError: "舊連接未在後端核准清單中，已停用。",
        enabled: false,
      });
  return [workspace, ...entries];
}
export function registerMcp(input: {
  id: string;
  name: string;
  endpoint?: string;
  transport?: McpEntry["transport"];
  authMode?: McpEntry["authMode"];
  credentialReference?: string | null;
  readonly?: boolean;
}) {
  if (input.endpoint && githubIsNotMcp(input.endpoint))
    throw new ApiError(400, "github_is_not_mcp", "GitHub 網址不是 MCP 端點。");
  const config = controlled(input.id);
  if (
    (input.endpoint && validateEndpoint(input.endpoint) !== config.endpoint) ||
    (input.credentialReference !== undefined &&
      input.credentialReference !== config.credentialReference) ||
    (input.authMode &&
      input.authMode !== (config.credentialReference ? "bearer" : "none")) ||
    (input.transport && input.transport !== "streamable-http") ||
    (input.readonly !== undefined && input.readonly !== config.readonly)
  )
    throw new ApiError(
      403,
      "mcp_target_mismatch",
      "端點、憑證與權限必須符合後端核准設定，不能從前端覆寫。",
    );
  return put("mcp_registry", WORKSPACE_OWNER, {
    ...config,
    transport: "streamable-http",
    authMode: config.credentialReference ? "bearer" : "none",
    tools: [],
    status: "unconfigured",
    verifiedAt: null,
    lastError: null,
    trustedLevel: "external",
    enabled: true,
  } satisfies McpEntry);
}
export function interpretVerification(steps: {
  initialize: boolean;
  toolsList: boolean;
  safeRead: boolean;
}): McpStatus {
  if (!steps.initialize) return "failed";
  if (!steps.toolsList) return "connected";
  return steps.safeRead ? "verified" : "partial";
}
export async function probeMcp(entry: McpEntry, signal?: AbortSignal) {
  if (!entry.enabled) return entry;
  const config = controlled(entry.id); // Recheck stored records before every outgoing request.
  if (config.credentialReference && !runtimeEnv(config.credentialReference)) {
    return put("mcp_registry", WORKSPACE_OWNER, {
      ...entry,
      ...config,
      tools: [],
      status: "unconfigured" as const,
      verifiedAt: null,
      lastError: "此 MCP 缺少後端服務憑證。",
    });
  }
  const client = new Client({ name: "hermes-console-discovery", version: "2" });
  let connected = false;
  const deadline = AbortSignal.timeout(20_000);
  const credential = config.credentialReference
    ? runtimeEnv(config.credentialReference)
    : undefined;
  const currentEntry = () => {
    const current = getMcp(entry.id);
    if (
      !current?.enabled ||
      current.endpoint !== config.endpoint ||
      current.credentialReference !== config.credentialReference
    )
      return (
        current || {
          ...entry,
          enabled: false,
          tools: [],
          status: "unconfigured" as const,
        }
      );
    if (
      credential !==
      (config.credentialReference
        ? runtimeEnv(config.credentialReference)
        : undefined)
    )
      return {
        ...current,
        tools: [],
        status: "unconfigured" as const,
        verifiedAt: null,
        lastError: "憑證已變更，需重新探索。",
      };
    return null;
  };
  try {
    const headers: Record<string, string> = {};
    if (config.credentialReference) {
      const token = runtimeEnv(config.credentialReference);
      if (!token)
        throw new ApiError(
          503,
          "mcp_credential_missing",
          "此 MCP 缺少後端服务憑證。",
        );
      headers.Authorization = "Bearer " + token;
    }
    const target = new URL(config.endpoint);
    const transport = new StreamableHTTPClientTransport(target, {
      requestInit: { headers, redirect: "error" },
      fetch: async (url, init) => {
        if (new URL(String(url)).origin !== target.origin)
          throw new Error("MCP target changed");
        const response = await safeMcpFetch(url, {
          ...init,
          redirect: "error",
          signal: AbortSignal.any([
            deadline,
            ...(signal ? [signal] : []),
            ...(init?.signal ? [init.signal] : []),
            AbortSignal.timeout(15_000),
          ]),
        });
        if (!response.body) return response;
        let size = 0;
        return new Response(
          response.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                size += chunk.byteLength;
                if (size > 2_000_000) throw new Error("MCP response limit");
                controller.enqueue(chunk);
              },
            }),
          ),
          {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          },
        );
      },
    });
    await client.connect(transport, { timeout: 10_000 });
    connected = true;
    let cursor: string | undefined;
    const tools: McpEntry["tools"] = [];
    for (let page = 0; page < 10; page++) {
      const result = await client.listTools(cursor ? { cursor } : {}, {
        timeout: 10_000,
      });
      tools.push(
        ...result.tools.map((t) => ({
          name: redact(t.name),
          description: redact(t.description || ""),
          inputSchema: JSON.parse(
            redact(JSON.stringify(t.inputSchema)),
          ) as Record<string, unknown>,
          outputSchema:
            t.outputSchema &&
            (JSON.parse(redact(JSON.stringify(t.outputSchema))) as Record<
              string,
              unknown
            >),
          annotations: t.annotations && {
            readOnlyHint: t.annotations.readOnlyHint,
            destructiveHint: t.annotations.destructiveHint,
            idempotentHint: t.annotations.idempotentHint,
          },
        })),
      );
      if (tools.length > 1000) throw new Error("MCP tool limit");
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    if (cursor) throw new Error("MCP pagination limit");
    const changed = currentEntry();
    if (changed) return changed;
    return put("mcp_registry", WORKSPACE_OWNER, {
      ...entry,
      ...config,
      tools,
      status: interpretVerification({
        initialize: true,
        toolsList: tools.length > 0,
        safeRead: false,
      }),
      verifiedAt: new Date().toISOString(),
      lastError: null,
      serverInfo: JSON.parse(
        redact(JSON.stringify(client.getServerVersion() || {})),
      ),
      capabilities: JSON.parse(
        redact(JSON.stringify(client.getServerCapabilities() || {})),
      ),
    });
  } catch (error) {
    // Never echo upstream bodies, arbitrary exception URLs or secret-bearing headers.
    const changed = currentEntry();
    if (changed) return changed;
    return put("mcp_registry", WORKSPACE_OWNER, {
      ...entry,
      ...config,
      tools: [],
      status:
        !connected &&
        error instanceof ApiError &&
        error.code === "mcp_credential_missing"
          ? ("unconfigured" as const)
          : connected
            ? ("connected" as const)
            : ("failed" as const),
      verifiedAt: null,
      lastError:
        error instanceof ApiError
          ? error.message
          : "MCP 協定或連線驗證失敗；請確認端點、憑證、版本與工具清單。",
    });
  } finally {
    await client.close().catch(() => {});
  }
}
export function setMcpEnabled(id: string, enabled: boolean) {
  const entry = getMcp(id);
  if (!entry || id === "workspace")
    throw new ApiError(404, "mcp_not_found", "找不到可管理的 MCP。");
  const config = controlled(id);
  return put("mcp_registry", WORKSPACE_OWNER, {
    ...entry,
    ...config,
    enabled,
    status: "unconfigured" as const,
    tools: [],
    verifiedAt: null,
    lastError: enabled ? "已啟用，尚未重新同步工具清單。" : "此 MCP 已停用。",
  });
}
export function getMcp(id: string) {
  return seedRegistry().find((item) => item.id === id) || null;
}

/** Client-safe registry row: no endpoint, credential name, or tool schemas. */
export function publicMcpEntry(entry: McpEntry) {
  return {
    id: entry.id,
    name: entry.name,
    status: entry.status,
    enabled: entry.enabled,
    readonly: entry.readonly,
    trustedLevel: entry.trustedLevel,
    toolsCount: entry.tools.length,
    tools: entry.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      annotations: tool.annotations,
    })),
    verifiedAt: entry.verifiedAt,
    lastError: entry.lastError,
  };
}

export function seedPublicRegistry() {
  return seedRegistry().map(publicMcpEntry);
}

/**
 * Config-only MCP is awaiting verification, never "partial"/"available".
 * Overlay live registry after initialize／tools/list／safe-read.
 */
export function honestConfiguredStatus<T extends { state: string; detail: string }>(
  id: string,
  base: T,
): T {
  if (base.state === "unconfigured" || base.state === "failed") return base;
  const entry = getMcp(id);
  if (entry?.status === "failed")
    return {
      ...base,
      state: "failed",
      detail: entry.lastError || base.detail,
    };
  if (entry?.status === "verified")
    return {
      ...base,
      state: "available",
      detail: "已通過安全讀取工具驗證。",
    };
  if (entry?.status === "partial" && entry.tools.length)
    return {
      ...base,
      state: "partial",
      detail: "已列出工具，尚未完成安全讀取驗證。",
    };
  return {
    ...base,
    state: "awaiting_authorization",
    detail: "已設定端點，尚未完成 initialize／tools/list。",
  };
}
