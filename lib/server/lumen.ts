import { z } from "zod";
import { ApiError, redact } from "./security";
import { runtimeEnv } from "./credentials";
import { githubIsNotMcp } from "./mcp-registry";

const context = {
  taskId: z.string().uuid().optional(),
  toolCallId: z.string().min(1).max(200).optional(),
};

const direction = z
  .object({
    title: z.string().trim().min(1).max(120),
    claim: z.string().trim().min(1).max(2000),
    visual: z.string().trim().min(1).max(4000),
    copy: z.string().trim().min(1).max(5000),
    cta: z.string().trim().min(1).max(1000),
    sources: z.array(z.string().url().max(500)).max(20).default([]),
  })
  .strict();

export const lumenSchemas = {
  lumen_list_tools: z.object({ ...context }).strict(),
  lumen_health: z.object({ ...context }).strict(),
  lumen_utter: z
    .object({
      text: z.string().trim().min(1).max(2000),
      ...context,
    })
    .strict(),
  lumen_get_session: z.object({ ...context }).strict(),
  lumen_list_board: z.object({ ...context }).strict(),
  lumen_get_research: z.object({ ...context }).strict(),
  lumen_list_receipts: z.object({ ...context }).strict(),
  lumen_lock_style: z.object({ ...context }).strict(),
  lumen_save_directions: z
    .object({
      brief: z.string().trim().min(1).max(10_000),
      directions: z.array(direction).min(3).max(5),
      ...context,
    })
    .strict(),
};

export type LumenToolName = keyof typeof lumenSchemas;

export const lumenDescriptions: Record<LumenToolName, string> = {
  lumen_list_tools:
    "列出 Lumen MCP 工具名稱。Hermes 經 Workspace MCP 呼叫，不必另開第二條連線。GitHub 倉庫網址不是 MCP。",
  lumen_health:
    "探測 Lumen Streamable HTTP MCP 是否可達。只回傳協定與工具名稱，不含權杖。Hermes Console 驗證連線時可先呼叫。",
  lumen_utter:
    "把口語交給 Lumen 創作導演。開案、三方向、研究卡、風格鎖定、分鏡都走這一句。不要叫使用者填 prompt 表單。可附 Console 的 taskId／toolCallId。",
  lumen_get_session:
    "讀取目前 Lumen 專案名稱、簡報、研究、方向與 Style DNA。不是長期記憶，也不是 Hermes 遠端記憶。",
  lumen_list_board: "列出畫板上可見卡片（生成、色票、筆記、分鏡、研究）。隱藏的非官方卡不會出現。",
  lumen_get_research: "讀取研究卡與來源標記（UNVERIFIED／FACT／CASE）。未核到的資料維持未確認，不要自行補完。",
  lumen_list_receipts: "列出最近由 Studio 或 Hermes Console 實際打進來的 MCP 工具收據。沒有收據就表示還沒被呼叫。",
  lumen_lock_style: "把目前配色與語氣寫入 Style DNA 並鎖定。沒有 DNA 時回「這次沒記住。」",
  lumen_save_directions:
    "保存 Hermes 依真實資料整理的三到五個方向（主張／視覺／文案／CTA／來源）到 Lumen 畫板。等待使用者在 Lumen 或 Console 選定。模型沒有選定工具。",
};

export function lumenConfigured() {
  const token = runtimeEnv("LUMEN_MCP_TOKEN");
  return !!(runtimeEnv("LUMEN_MCP_URL") && token && token.length >= 32);
}

/** Injected into Hermes task instructions so the agent actually calls lumen_*. */
export function lumenTaskInstructions() {
  if (!lumenConfigured()) return "";
  return [
    "",
    "Lumen 創作台已連線。提到開案、海報、文宣、招新、茶會、畫板、三個方向、Style DNA 時必須呼叫工作區 lumen_*（或 Runtime mcp.lumen.*），不要用文字假裝已開畫板。",
    "先 lumen_list_tools 或 lumen_health，口語一律 lumen_utter。不要叫使用者填 prompt 表單。",
    "你整理好的三到五個方向用 lumen_save_directions 放到畫板，等待使用者在 Lumen 或 Console 選定。不要呼叫不存在的 choose_direction。",
    "讀畫板走 lumen_get_session／lumen_list_board；校色未核到就標未確認。GitHub 倉庫網址不是 MCP。",
  ].join("\n");
}

export function isLumenTool(name: string): name is LumenToolName {
  return Object.prototype.hasOwnProperty.call(lumenSchemas, name);
}

export function lumenWriteTool(name: string) {
  return /lumen_utter|lumen_lock_style|lumen_save_directions/.test(name);
}

export function lumenStatus() {
  const url = runtimeEnv("LUMEN_MCP_URL");
  if (!url)
    return {
      id: "lumen",
      name: "Lumen 創作台",
      state: "unconfigured" as const,
      detail: "尚未設定 LUMEN_MCP_URL。GitHub 倉庫網址不是 MCP。",
    };
  if (githubIsNotMcp(url))
    return {
      id: "lumen",
      name: "Lumen 創作台",
      state: "failed" as const,
      detail: "GitHub 網址不是 MCP 端點。請改填 Lumen /api/mcp。",
    };
  const token = runtimeEnv("LUMEN_MCP_TOKEN");
  if (!token || token.length < 32)
    return {
      id: "lumen",
      name: "Lumen 創作台",
      state: "unconfigured" as const,
      detail: "已設定端點，請貼上至少 32 字元的 LUMEN_MCP_TOKEN。",
    };
  return {
    id: "lumen",
    name: "Lumen 創作台",
    state: "partial" as const,
    detail: "已設定端點與服務憑證。Hermes 可經 Workspace MCP 呼叫 lumen_*；探測通過代表有真實工具清單。文宣意圖必須真的呼叫，不要用文字假裝已開畫板。",
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
    if (!last) throw new ApiError(502, "lumen_empty", "Lumen MCP 串流沒有回傳資料。");
    return JSON.parse(last) as RpcResult;
  }
  return JSON.parse(text) as RpcResult;
}

function remoteArgs(name: LumenToolName, args: Record<string, unknown>) {
  const next = { ...args };
  delete next.taskId;
  delete next.toolCallId;
  if (name === "lumen_utter") return { text: next.text };
  if (name === "lumen_save_directions")
    return { brief: next.brief, directions: next.directions };
  return {};
}

let rpcSeq = 0;
let cachedSession: string | undefined;

export function resetLumenClient() {
  cachedSession = undefined;
}

async function lumenRpc(
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
  timeoutMs = 15_000,
) {
  const endpoint = runtimeEnv("LUMEN_MCP_URL");
  if (!endpoint)
    throw new ApiError(503, "lumen_unconfigured", "尚未設定 LUMEN_MCP_URL。");
  if (githubIsNotMcp(endpoint))
    throw new ApiError(400, "github_is_not_mcp", "GitHub 網址不是 MCP 端點。");
  const token = runtimeEnv("LUMEN_MCP_TOKEN");
  if (!token || token.length < 32)
    throw new ApiError(503, "mcp_credential_missing", "此 MCP 缺少後端服務憑證。");
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
  if (!notify) payload.id = ++rpcSeq;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    redirect: "error",
    cache: "no-store",
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const nextSession = response.headers.get("mcp-session-id") || sessionId;
  if (notify) {
    await response.body?.cancel();
    return { result: {}, sessionId: nextSession };
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(502, "lumen_http", "Lumen MCP 回應異常，沒有產生替代成果。");
  }
  const json = parseRpcBody(
    await response.text(),
    response.headers.get("content-type") || "",
  );
  if (json.error)
    throw new ApiError(
      502,
      "lumen_rpc",
      redact(json.error.message || "Lumen MCP 回傳錯誤。"),
    );
  return { result: json.result, sessionId: nextSession };
}

async function handshake() {
  const init = await lumenRpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "hermes-console", version: "2" },
    },
    undefined,
    10_000,
  );
  await lumenRpc("notifications/initialized", {}, init.sessionId, 5_000).catch(
    () => {},
  );
  return init.sessionId;
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
        "lumen_tool_failed",
        redact(text || "Lumen 工具執行失敗，沒有產生替代成果。"),
      );
    }
    if (rec.structuredContent && typeof rec.structuredContent === "object")
      return flattenLumenPayload(rec.structuredContent);
    if (Array.isArray(rec.tools)) {
      return { tools: rec.tools, count: rec.tools.length, runtimePrefix: "mcp.lumen" };
    }
    const text = rec.content?.find((c) => c.type === "text")?.text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          return flattenLumenPayload(parsed as Record<string, unknown>);
      } catch {
        return { text };
      }
    }
  }
  throw new ApiError(502, "lumen_empty", "Lumen 沒有回傳可用結果。");
}

/** Hermes reads top-level fields. Keep project nested, also lift name/cards/directions. */
export function flattenLumenPayload(sc: Record<string, unknown>): Record<string, unknown> {
  const project = sc.project;
  if (!project || typeof project !== "object" || Array.isArray(project)) return sc;
  const p = project as Record<string, unknown>;
  return {
    ...sc,
    name: sc.name ?? p.name,
    speech: sc.speech ?? p.speech,
    cards: sc.cards ?? p.cards,
    directions: sc.directions ?? p.directions,
    dna: sc.dna ?? p.dna,
    research: sc.research ?? p.research,
    selectedDirection: sc.selectedDirection ?? p.selectedDirection,
  };
}

export async function invokeLumen(
  name: LumenToolName,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const run = async (fresh: boolean) => {
    if (fresh) cachedSession = undefined;
    cachedSession ??= await handshake();
    if (name === "lumen_list_tools") {
      const listed = await lumenRpc("tools/list", {}, cachedSession, 20_000);
      const tools =
        listed.result && typeof listed.result === "object"
          ? (listed.result as { tools?: Array<{ name: string; description?: string }> }).tools || []
          : [];
      return {
        tools: tools.map((t) => ({ name: t.name, description: redact(t.description || "") })),
        count: tools.length,
        runtimePrefix: "mcp.lumen",
      };
    }
    const forwarded = {
      ...remoteArgs(name, args),
      ...(typeof args.taskId === "string" ? { taskId: args.taskId } : {}),
      ...(typeof args.toolCallId === "string" ? { toolCallId: args.toolCallId } : {}),
    };
    return unwrapToolResult(
      (await lumenRpc("tools/call", { name, arguments: forwarded }, cachedSession, 60_000)).result,
    );
  };
  try {
    return await run(false);
  } catch (error) {
    try {
      return await run(true);
    } catch {
      throw error;
    }
  }
}
