import { ApiError, redact } from "./security";
import { runtimeEnv } from "./credentials";
import { configuredMcp, getMcp, githubIsNotMcp } from "./mcp-registry";

const WRITE = /^(set_|create_|mark_|verify_)/;
const COMMON_SCHEMA = {
  type: "object",
  properties: {
    projectId: { type: "string" },
    shotId: { type: "string" },
    frameId: { type: "string" },
    sceneId: { type: "string" },
    characterId: { type: "string" },
    propId: { type: "string" },
  },
} as const;

const FALLBACK: Array<{ name: string; description: string }> = [
  { name: "get_character_bible", description: "讀取角色聖經與身份鎖。Never a similarity percentage." },
  { name: "get_scene_bible", description: "讀取場次聖經與環境身份。反打不是新車站。" },
  { name: "get_style_bible", description: "讀取風格聖經。" },
  { name: "get_prop_bible", description: "讀取道具聖經。同一行李箱必須是同一把。" },
  { name: "get_golden_reference", description: "讀取 Golden 參考（依欄位與視點）。側鏡對側臉。" },
  { name: "set_golden_reference", description: "指定 Golden 參考。" },
  { name: "get_reference_library", description: "讀取參考庫。" },
  { name: "get_project_tree", description: "讀取專案 → 場次 → 鏡頭樹。" },
  { name: "get_scene", description: "讀取單一場次與鏡頭。" },
  { name: "get_shot", description: "讀取鏡頭、前後鏡與演員道具。" },
  { name: "analyze_character_consistency", description: "分析角色連戲；不是相似度百分比。" },
  { name: "get_identity_lock", description: "讀取角色身份鎖報告。" },
  { name: "analyze_face_consistency", description: "分析臉部連戲。微笑不是換臉。" },
  { name: "get_face_consistency", description: "讀取臉部連戲報告。" },
  { name: "get_outfit_bible", description: "讀取服裝聖經。" },
  { name: "analyze_outfit_consistency", description: "分析服裝連戲。明示換裝不是錯誤。" },
  { name: "get_outfit_consistency", description: "讀取服裝連戲報告。" },
  { name: "get_outfit_transitions", description: "列出明示換裝轉場。" },
  { name: "create_outfit_transition", description: "記錄明示換裝轉場。" },
  { name: "get_scale_anchors", description: "讀取相對比例錨點。" },
  { name: "analyze_scale_consistency", description: "分析身材與比例連戲。" },
  { name: "get_scale_consistency", description: "讀取比例連戲報告。" },
  { name: "create_scale_anchor", description: "建立相對比例錨點。" },
  { name: "analyze_scene_consistency", description: "分析場景結構連戲。反打不是新車站。" },
  { name: "get_environment_consistency", description: "讀取環境連戲報告。" },
  { name: "analyze_style_consistency", description: "分析風格連戲。更漂亮但離開這個世界是漂移。" },
  { name: "get_lighting_bible", description: "讀取燈光聖經。" },
  { name: "analyze_lighting_consistency", description: "分析燈光連戲。反打不是新太陽。" },
  { name: "get_lighting_consistency", description: "讀取燈光連戲報告。" },
  { name: "get_lighting_transitions", description: "列出明示燈光轉場。" },
  { name: "create_lighting_transition", description: "記錄明示燈光轉場。" },
  { name: "get_style_consistency", description: "讀取風格連戲報告。" },
  { name: "analyze_prop_consistency", description: "分析道具身份連戲。放下不是新行李箱。" },
  { name: "get_prop_consistency", description: "讀取道具身份報告。" },
  { name: "analyze_prop_continuity", description: "追蹤道具跨鏡連續性。" },
  { name: "get_prop_continuity", description: "讀取道具連續性報告。" },
  { name: "get_prop_actions", description: "列出明示道具動作。" },
  { name: "create_prop_action", description: "記錄明示道具動作。" },
  { name: "analyze_cross_shot_consistency", description: "跨鏡連戲總覽。" },
  { name: "get_consistency_issues", description: "列出連戲問題。" },
  { name: "get_continuity_state", description: "讀取鏡頭前後連續狀態。" },
  { name: "create_repair_request", description: "建立修復請求。" },
  { name: "verify_repair", description: "標記修復已驗證。" },
  { name: "mark_accepted_variation", description: "將問題標為可接受變體。" },
];

export function consistencylabConfigured() {
  if (runtimeEnv("CONSISTENCYLAB_MCP_URL")) return true;
  try {
    return configuredMcp().some((item) => item.id === "consistencylab");
  } catch {
    return false;
  }
}

export function consistencylabStatus() {
  const url = runtimeEnv("CONSISTENCYLAB_MCP_URL");
  if (!url)
    return {
      id: "consistencylab",
      name: "ConsistencyLab",
      state: "unconfigured" as const,
      detail: "尚未設定 CONSISTENCYLAB_MCP_URL。GitHub 倉庫網址不是 MCP。",
    };
  if (githubIsNotMcp(url))
    return {
      id: "consistencylab",
      name: "ConsistencyLab",
      state: "failed" as const,
      detail: "GitHub 網址不是 MCP 端點。請改填 ConsistencyLab 的 /api/mcp。",
    };
  return {
    id: "consistencylab",
    name: "ConsistencyLab",
    state: "partial" as const,
    detail: "已設定端點，需 initialize／tools/list 驗證後 Hermes 才能呼叫 mcp.consistencylab 與 clab_*。",
  };
}

export function consistencylabWorkspaceTools() {
  if (!consistencylabConfigured()) return [];
  let probed: ReturnType<typeof getMcp> | undefined;
  try {
    probed = getMcp("consistencylab");
  } catch {
    probed = undefined;
  }
  const source =
    probed?.tools?.length
      ? probed.tools
      : FALLBACK.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: { ...COMMON_SCHEMA },
          annotations: {
            readOnlyHint: !WRITE.test(tool.name),
            destructiveHint: false,
            idempotentHint: /^(get_|analyze_)/.test(tool.name),
          },
        }));
  const listed = source.map((tool) => {
    const raw = tool.name.replace(/^clab_/, "");
    return {
      name: raw.startsWith("clab_") ? raw : `clab_${raw}`,
      description: tool.description,
      inputSchema: (tool.inputSchema || { ...COMMON_SCHEMA }) as Record<string, unknown>,
      annotations: {
        readOnlyHint: tool.annotations?.readOnlyHint ?? !WRITE.test(raw),
        destructiveHint: tool.annotations?.destructiveHint ?? false,
        idempotentHint: tool.annotations?.idempotentHint ?? /^(get_|analyze_)/.test(raw),
        openWorldHint: true,
      },
    };
  });
  if (!listed.some((tool) => tool.name === "clab_list_tools")) {
    listed.unshift({
      name: "clab_list_tools",
      description: "列出 ConsistencyLab MCP 工具名稱與讀寫註記。GitHub 倉庫網址不是 MCP。",
      inputSchema: { type: "object", properties: {} },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    });
  }
  if (!listed.some((tool) => tool.name === "clab_call")) {
    listed.push({
      name: "clab_call",
      description: "呼叫任意 ConsistencyLab MCP 工具。寫入需 confirmed=true。不要把 GitHub 當端點。",
      inputSchema: {
        type: "object",
        properties: {
          tool: { type: "string" },
          arguments: { type: "object" },
          confirmed: { type: "boolean" },
        },
        required: ["tool"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    });
  }
  return listed;
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
    if (!last) throw new ApiError(502, "consistencylab_empty", "ConsistencyLab MCP 串流沒有回傳資料。");
    return JSON.parse(last) as RpcResult;
  }
  return JSON.parse(text) as RpcResult;
}

async function consistencylabRpc(
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
  timeoutMs = 15_000,
) {
  const config = configuredMcp().find((item) => item.id === "consistencylab");
  if (!config)
    throw new ApiError(503, "consistencylab_unconfigured", "尚未設定 CONSISTENCYLAB_MCP_URL。");
  if (githubIsNotMcp(config.endpoint))
    throw new ApiError(400, "github_is_not_mcp", "GitHub 網址不是 MCP 端點。");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
  };
  if (config.credentialReference) {
    const token = runtimeEnv(config.credentialReference);
    if (token) headers.Authorization = "Bearer " + token;
  }
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const notify = method.startsWith("notifications/");
  const payload: Record<string, unknown> = { jsonrpc: "2.0", method, params };
  if (!notify) payload.id = Date.now() % 1_000_000;
  const response = await fetch(config.endpoint, {
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
      "consistencylab_http",
      "ConsistencyLab MCP 回應 " + response.status + "，沒有產生替代成果。",
    );
  const json = parseRpcBody(await response.text(), response.headers.get("content-type") || "");
  if (json.error)
    throw new ApiError(502, "consistencylab_rpc", redact(json.error.message || "ConsistencyLab MCP 回傳錯誤。"));
  return {
    result: json.result,
    sessionId: response.headers.get("mcp-session-id") || sessionId,
  };
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
        "consistencylab_tool_failed",
        redact(text || "ConsistencyLab 工具執行失敗，沒有產生替代成果。"),
      );
    }
    if (rec.structuredContent && typeof rec.structuredContent === "object") {
      return rec.structuredContent;
    }
    if (Array.isArray(rec.tools)) return { tools: rec.tools };
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
  throw new ApiError(502, "consistencylab_empty", "ConsistencyLab 沒有回傳可用結果。");
}

export async function invokeConsistencylab(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const init = await consistencylabRpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "hermes-console", version: "2" },
    },
    undefined,
    10_000,
  );
  await consistencylabRpc("notifications/initialized", {}, init.sessionId, 5_000).catch(() => {});
  if (name === "list_tools") {
    const listed = await consistencylabRpc("tools/list", {}, init.sessionId, 20_000);
    const tools =
      listed.result && typeof listed.result === "object"
        ? (listed.result as { tools?: Array<{ name: string; description?: string }> }).tools || []
        : [];
    return {
      tools: tools.map((t) => ({ name: t.name, description: redact(t.description || "") })),
      count: tools.length,
      runtimePrefix: "mcp.consistencylab",
      workspacePrefix: "clab_",
    };
  }
  let remoteName = name;
  let remoteArgs = { ...args };
  if (name === "call") {
    remoteName = String(args.tool || "");
    remoteArgs = { ...((args.arguments as Record<string, unknown>) || {}) };
    if (args.confirmed === true) remoteArgs.confirmed = true;
  }
  const called = await consistencylabRpc(
    "tools/call",
    { name: remoteName, arguments: remoteArgs },
    init.sessionId,
    60_000,
  );
  return unwrapToolResult(called.result);
}
