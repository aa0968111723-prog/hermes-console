import { NextRequest } from "next/server";
import { normalizeBaseUrl, HERMES_DEFAULTS } from "@/lib/hermes-config";
import { HERMES_TOOLS, executeHermesTool } from "@/lib/tools";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawUrl = body.baseUrl || process.env.HERMES_API_URL || "";
    const base = normalizeBaseUrl(rawUrl);
    // 優先採用傳入的 Key，若無則採用環境變數或 Zeabur 預設 Key
    const key = (body.apiKey || process.env.HERMES_API_KEY || HERMES_DEFAULTS.DEFAULT_API_KEY).trim();
    const model = body.model || process.env.HERMES_MODEL || HERMES_DEFAULTS.DEFAULT_MODEL;
    const activeProject = body.activeProject || "hermes-console";

    if (!base) {
      return Response.json(
        {
          error: "尚未設定 Hermes API 網域。請在設定中填入您在 Zeabur 綁定的 API 網域（例如 https://your-hermes.zeabur.app）。"
        },
        { status: 400 }
      );
    }

    // 系統提示詞：定義 Hermes 作為專案之腦
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

    const incomingMessages = Array.isArray(body.messages) ? body.messages : [];
    const formattedMessages = [systemPrompt, ...incomingMessages];

    // 向 Zeabur 上的 Hermes Agent API 發送請求
    const targetUrl = `${base}/v1/chat/completions`;
    const payload = {
      model,
      stream: true,
      messages: formattedMessages,
      tools: HERMES_TOOLS,
      tool_choice: "auto"
    };

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(payload)
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      let tip = `Hermes 回傳 HTTP ${upstream.status}。`;
      if (upstream.status === 404) {
        tip += " 找不到 /v1/chat/completions，請檢查 Zeabur 網域是否已綁定至 API 埠。";
      } else if (upstream.status === 401 || upstream.status === 403) {
        tip += " API Key 驗證失敗，請檢查 Key 是否正確。";
      } else if (upstream.status === 502 || upstream.status === 503) {
        tip += " Zeabur 服務正在啟動中或暫時無法連線。";
      }
      return Response.json({ error: `${tip}\n詳細訊息：${errText}` }, { status: upstream.status || 502 });
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `連線至 Zeabur Hermes 失敗：${msg}。請確認網域是否在線且能正常解析。` },
      { status: 500 }
    );
  }
}
