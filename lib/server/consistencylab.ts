import { ApiError, redact } from "./security";
import { runtimeEnv } from "./credentials";
import { configuredMcp, getMcp } from "./mcp-registry";

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
  { name: "get_character_bible", description: "讀取角色聖經與身份鎖。" },
  { name: "get_scene_bible", description: "讀取場次聖經與環境身份。" },
  { name: "get_style_bible", description: "讀取風格聖經。" },
  { name: "get_prop_bible", description: "讀取道具聖經。" },
  { name: "get_golden_reference", description: "讀取 Golden 參考（依欄位與視點）。" },
  { name: "set_golden_reference", description: "指定 Golden 參考。" },
  { name: "get_reference_library", description: "讀取參考庫。" },
  { name: "get_project_tree", description: "讀取專案 → 場次 → 鏡頭樹。" },
  { name: "get_scene", description: "讀取單一場次與鏡頭。" },
  { name: "get_shot", description: "讀取鏡頭、前後鏡與演員道具。" },
  { name: "analyze_character_consistency", description: "分析角色連戲；不是相似度百分比。" },
  { name: "get_identity_lock", description: "讀取角色身份鎖報告。" },
  { name: "analyze_face_consistency", description: "分析臉部連戲。" },
  { name: "get_face_consistency", description: "讀取臉部連戲報告。" },
  { name: "get_outfit_bible", description: "讀取服裝聖經。" },
  { name: "analyze_outfit_consistency", description: "分析服裝連戲。" },
  { name: "get_outfit_consistency", description: "讀取服裝連戲報告。" },
  { name: "get_outfit_transitions", description: "列出明示換裝轉場。" },
  { name: "create_outfit_transition", description: "記錄明示換裝轉場。" },
  { name: "get_scale_anchors", description: "讀取相對比例錨點。" },
  { name: "analyze_scale_consistency", description: "分析身材與比例連戲。" },
  { name: "get_scale_consistency", description: "讀取比例連戲報告。" },
  { name: "create_scale_anchor", description: "建立相對比例錨點。" },
  { name: "analyze_scene_consistency", description: "分析場景結構連戲。" },
  { name: "get_environment_consistency", description: "讀取環境連戲報告。" },
  { name: "analyze_style_consistency", description: "分析風格連戲。" },
  { name: "get_lighting_bible", description: "讀取燈光聖經。" },
  { name: "analyze_lighting_consistency", description: "分析燈光連戲。" },
  { name: "get_lighting_consistency", description: "讀取燈光連戲報告。" },
  { name: "get_lighting_transitions", description: "列出明示燈光轉場。" },
  { name: "create_lighting_transition", description: "記錄明示燈光轉場。" },
  { name: "get_style_consistency", description: "讀取風格連戲報告。" },
  { name: "analyze_prop_consistency", description: "分析道具身份連戲。" },
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

export function consistencylabWorkspaceTools() {
  if (!consistencylabConfigured()) return [];
  const probed = getMcp("consistencylab");
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
  return source.map((tool) => {
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
}

function parseMcpBody(text: string, contentType: string) {
  if (contentType.includes("text/event-stream")) {
    const lines = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    const last = lines.at(-1);
    if (!last) throw new Error("empty sse");
    return JSON.parse(last) as unknown;
  }
  return JSON.parse(text) as unknown;
}

export async function callConsistencylabTool(
  name: string,
  args: Record<string, unknown>,
) {
  const config = configuredMcp().find((item) => item.id === "consistencylab");
  if (!config)
    throw new ApiError(
      404,
      "consistencylab_unconfigured",
      "尚未設定 ConsistencyLab MCP 網址。",
    );
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
  };
  if (config.credentialReference) {
    const token = runtimeEnv(config.credentialReference);
    if (token) headers.Authorization = "Bearer " + token;
  }
  const target = new URL(config.endpoint);
  const response = await fetch(target, {
    method: "POST",
    headers,
    redirect: "error",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: {
              code: "consistencylab_http",
              message: "ConsistencyLab 工具呼叫失敗。",
            },
          }),
        },
      ],
      isError: true,
    };
  }
  let parsed: unknown;
  try {
    parsed = parseMcpBody(text, response.headers.get("content-type") || "");
  } catch {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: {
              code: "consistencylab_protocol",
              message: "ConsistencyLab 回傳不是 JSON-RPC。",
            },
          }),
        },
      ],
      isError: true,
    };
  }
  const rpc = parsed as {
    result?: {
      content?: unknown;
      structuredContent?: unknown;
      isError?: boolean;
    };
    error?: { message?: string };
  };
  if (rpc.error) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: {
              code: "consistencylab_rpc",
              message: redact(rpc.error.message || "工具失敗"),
            },
          }),
        },
      ],
      isError: true,
    };
  }
  const result = rpc.result;
  if (result && Array.isArray(result.content)) {
    return {
      content: result.content as Array<{ type: "text"; text: string }>,
      structuredContent: result.structuredContent,
      isError: Boolean(result.isError),
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result ?? {}) }],
    structuredContent: result,
    isError: false,
  };
}

export async function invokeConsistencylab(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const wrapped = await callConsistencylabTool(name, args);
  if (wrapped.isError) {
    const text = wrapped.content.find((item) => item.type === "text")?.text;
    let message = "ConsistencyLab 工具執行失敗，沒有產生替代成果。";
    try {
      const parsed = JSON.parse(text || "") as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* keep default */
    }
    throw new ApiError(502, "consistencylab_tool_failed", redact(message));
  }
  const structured = wrapped.structuredContent;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) {
    return structured as Record<string, unknown>;
  }
  const text = wrapped.content.find((item) => item.type === "text")?.text;
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { text };
    }
    return { text };
  }
  throw new ApiError(502, "consistencylab_empty", "ConsistencyLab 沒有回傳可用結果。");
}
