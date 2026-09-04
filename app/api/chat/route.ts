import { NextRequest } from "next/server";
import { normalizeBaseUrl, HERMES_DEFAULTS } from "@/lib/hermes-config";
import { HERMES_TOOLS } from "@/lib/tools";
import { streamLocalHermesResponse } from "@/lib/local-brain";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawUrl = body.baseUrl || process.env.HERMES_API_URL || "";
    const base = normalizeBaseUrl(rawUrl);
    const key = (body.apiKey || process.env.HERMES_API_KEY || HERMES_DEFAULTS.DEFAULT_API_KEY).trim();
    const model = body.model || process.env.HERMES_MODEL || HERMES_DEFAULTS.DEFAULT_MODEL;
    const activeProject = body.activeProject || "hermes-console";
    const forceLocal = Boolean(body.forceLocal);

    const incomingMessages = Array.isArray(body.messages) ? body.messages : [];

    // 1. 若使用者選擇強制本地或未填寫網域，直接走本地高擬真大腦
    if (forceLocal || !base) {
      const generator = streamLocalHermesResponse(incomingMessages, activeProject);
      const stream = new ReadableStream({
        async pull(controller) {
          const { value, done } = await generator.next();
          if (done) {
            controller.close();
          } else {
            controller.enqueue(new TextEncoder().encode(value));
          }
        }
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive"
        }
      });
    }

    // 2. 嘗試向 Zeabur 上的 Hermes Agent API 請求
    const systemPrompt = {
      role: "system",
      content: [
        `你是柯能（Bruce）的中央大腦 Hermes Agent，直接部署於 Zeabur 雲端服務，並作為 hermes-console 前端的智能核心。`,
        `當前聚焦專案：[${activeProject}]。`,
        `你擁有並可以直接調用內建工具：`,
        `- get_ecosystem_projects: 檢索 41 個專案目錄`,
        `- inspect_project: 查詢專案詳細技術規格與 GitHub`,
        `- get_zeabur_dashboard_info: 查詢 Zeabur 儀表板管理資訊`,
        `- check_hermes_status: 檢測大腦運行狀態`,
        `- generate_creative_brief: 產生 16:9 分鏡鏡頭與視覺海報規格`,
        `- run_text_transform: 繁體中文切句與鏡頭拆解`,
        `原則：`,
        `1. 一律使用繁體中文。`,
        `2. 當使用者詢問專案、狀態或需要拆解規格時，主動調用對應工具。`,
        `3. 絕不洩漏系統內部敏感憑證，保護密鑰安全。`,
        `4. 思考縝密、邏輯清晰、具備高階前端與導演視角。`
      ].join("\n")
    };

    const formattedMessages = [systemPrompt, ...incomingMessages];
    const targetUrl = `${base}/v1/chat/completions`;

    try {
      const upstream = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: formattedMessages,
          tools: HERMES_TOOLS,
          tool_choice: "auto"
        }),
        signal: AbortSignal.timeout(12000)
      });

      if (upstream.ok && upstream.body) {
        return new Response(upstream.body, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive"
          }
        });
      }
    } catch {
      // 網路連線或 upstream 失敗，自動轉入本機大腦備援
    }

    // 3. Zeabur 雲端未能即時回應時，無縫切換至本地大腦沙盒，確保對話不中斷
    const fallbackGenerator = streamLocalHermesResponse(incomingMessages, activeProject);
    const fallbackStream = new ReadableStream({
      async pull(controller) {
        const { value, done } = await fallbackGenerator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(new TextEncoder().encode(value));
        }
      }
    });

    return new Response(fallbackStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
