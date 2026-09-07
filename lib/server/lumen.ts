import { z } from "zod";
import { ApiError } from "./security";
import { runtimeEnv } from "./credentials";

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
  lumen_health: z.object({ ...context }).strict(),
  lumen_utter: z
    .object({ text: z.string().trim().min(1).max(2000), ...context })
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
} as const;

export type LumenToolName = keyof typeof lumenSchemas;

export const lumenDescriptions: Record<LumenToolName, string> = {
  lumen_health:
    "探測 Lumen 創作台 MCP 是否可達。只回傳協定與工具名稱。不是長期記憶。",
  lumen_utter:
    "把口語交給 Lumen 創作導演。開案、三方向、研究卡、風格鎖定都走這一句。可附目前 taskId。",
  lumen_get_session:
    "讀取 Lumen 目前專案、簡報、研究與 Style DNA。不是 Hermes 遠端記憶。",
  lumen_list_board: "列出 Lumen 畫板上可見卡片。隱藏的非官方卡不會出現。",
  lumen_get_research:
    "讀取 Lumen 研究卡。未核到的資料維持未確認，不要自行補完。",
  lumen_list_receipts: "列出 Lumen 實際收到的 MCP 工具收據。",
  lumen_lock_style: "鎖定目前 Lumen Style DNA。沒有 DNA 時會明確說沒記住。",
  lumen_save_directions:
    "把三到五個方向寫進 Lumen 畫板，等待使用者選定。模型沒有選定工具。",
};

export function lumenConfigured() {
  return !!(runtimeEnv("LUMEN_MCP_URL") && runtimeEnv("LUMEN_MCP_TOKEN"));
}

export async function forwardLumen(
  name: LumenToolName,
  args: unknown,
  rpcId?: string | number,
) {
  const endpoint = runtimeEnv("LUMEN_MCP_URL");
  const token = runtimeEnv("LUMEN_MCP_TOKEN");
  if (!endpoint || !token)
    throw new ApiError(
      409,
      "lumen_unconfigured",
      "請先在連線設定保存 Lumen MCP 網址與權杖。",
    );
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId ?? 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(
      502,
      "lumen_network",
      "無法連線 Lumen MCP；沒有產生備援創作。",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(
      502,
      "lumen_upstream",
      "Lumen MCP 拒絕或失敗；沒有產生備援創作。",
    );
  }
  const contentType = response.headers.get("content-type") || "";
  let payload: { result?: unknown; error?: { message?: string } };
  try {
    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
      payload = dataLine
        ? (JSON.parse(dataLine.replace(/^data:\s?/, "")) as typeof payload)
        : {};
    } else {
      payload = (await response.json()) as typeof payload;
    }
  } catch {
    throw new ApiError(502, "lumen_invalid", "Lumen 未回傳有效 JSON-RPC。");
  }
  if (payload.error)
    throw new ApiError(
      502,
      "lumen_tool",
      "Lumen 工具失敗或參數不正確；請查看 Lumen 呼叫紀錄。",
    );
  const result = payload.result as {
    structuredContent?: Record<string, unknown>;
    content?: Array<{ text?: string }>;
  };
  if (result?.structuredContent && typeof result.structuredContent === "object")
    return result.structuredContent;
  const text = result?.content?.[0]?.text;
  if (typeof text === "string") {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { text };
    }
  }
  if (result && typeof result === "object")
    return result as Record<string, unknown>;
  return { ok: true };
}
