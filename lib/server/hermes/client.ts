import { normalizeBaseUrl, HERMES_DEFAULTS } from "../integrations/truth-status";
import { HERMES_TOOLS, executeHermesTool } from "./tools";
import { streamLocalHermesResponse, type ChatMessage } from "./local-brain";
import { getAgentProfile, type AgentProfile } from "./registry.ts";
import { getOrCreateSessionContext, type SessionContext } from "./session.ts";
import { recordUsage } from "./usage.ts";
import { searchMemories } from "./memory.ts";

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  profileId?: string;
  sessionKey?: string;
  activeProject?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  forceLocal?: boolean;
}

/**
 * 產生帶有 Profile 特化與專案記憶注入的系統提示詞
 */
function buildEnrichedSystemPrompt(profile: AgentProfile, activeProject: string, userQuery: string): string {
  // 從記憶庫檢索相關事實與背景
  const relevantMemories = searchMemories(userQuery, activeProject).slice(0, 3);
  const memoryContext = relevantMemories.length > 0
    ? `\n\n【專案與校園記憶上下文】：\n` +
      relevantMemories.map((m) => `- [${m.title}] (${m.evidenceType}): ${m.content}`).join("\n")
    : "";

  return [
    `你是柯能（Bruce）的中央大腦 Hermes Agent 體系之【${profile.name}】（角色代號：${profile.id}）。`,
    `當前焦點專案：[${activeProject}]。`,
    profile.systemPrompt,
    memoryContext,
    `\n可用工具限制：${profile.allowedTools.join(", ")}。`,
    `指導方針：`,
    `1. 絕對使用繁體中文輸出。`,
    `2. 保持專業，拒絕任何 AI 罐頭廢話（AI-slop）。`,
    `3. 進行深度思考時請在 <thought> 標籤內進行詳細推導，再給出清晰、可直接落地的方案。`
  ].join("\n");
}

/**
 * 核心對話串流處理器（支援雙引擎自動備援與完整可觀測性）
 */
export async function* streamHermesChat(
  req: ChatCompletionRequest
): AsyncGenerator<string, void, unknown> {
  const startTime = Date.now();
  const profile = getAgentProfile(req.profileId);
  const session: SessionContext = getOrCreateSessionContext(req.sessionKey, {
    activeProject: req.activeProject || "tku-zen-agent",
    profileId: profile.id
  });

  const lastUserMsg = [...req.messages].reverse().find((m) => m.role === "user")?.content || "";
  const systemPromptContent = buildEnrichedSystemPrompt(profile, session.activeProject, lastUserMsg);

  const formattedMessages = [
    { role: "system", content: systemPromptContent },
    ...req.messages
  ];

  const rawUrl = req.baseUrl || process.env.HERMES_API_URL || "";
  const base = normalizeBaseUrl(rawUrl);
  const key = (req.apiKey || process.env.HERMES_API_KEY || HERMES_DEFAULTS.DEFAULT_API_KEY).trim();
  const model = req.model || process.env.HERMES_MODEL || HERMES_DEFAULTS.DEFAULT_MODEL;

  const toolsForProfile = HERMES_TOOLS.filter((t) => profile.allowedTools.includes(t.function.name));

  let totalPromptChars = formattedMessages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  let totalCompletionChars = 0;
  let toolCallsCount = 0;
  const toolsUsed: string[] = [];

  // 發送初始狀態事件
  yield `event: status\ndata: ${JSON.stringify({
    profile: profile.id,
    profileName: profile.name,
    sessionKey: session.sessionKey,
    activeProject: session.activeProject,
    engine: !req.forceLocal && base ? "zeabur_cloud" : "local_brain"
  })}\n\n`;

  // 1. 若設定了有效網域且未強制本地，嘗試請求 Zeabur
  if (!req.forceLocal && base) {
    try {
      const upstream = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "X-Hermes-Session-Key": session.sessionKey
        },
        body: JSON.stringify({
          model,
          stream: true,
          temperature: profile.temperature,
          messages: formattedMessages,
          tools: toolsForProfile.length > 0 ? toolsForProfile : undefined,
          tool_choice: toolsForProfile.length > 0 ? "auto" : undefined
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (upstream.ok && upstream.body) {
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          totalCompletionChars += chunk.length;

          // 直通轉發 SSE chunk
          yield chunk;
        }

        // 記錄用量
        const latencyMs = Date.now() - startTime;
        recordUsage({
          sessionKey: session.sessionKey,
          profileId: profile.id,
          model,
          promptTokens: Math.ceil(totalPromptChars / 2.5),
          completionTokens: Math.ceil(totalCompletionChars / 2.5),
          totalTokens: Math.ceil((totalPromptChars + totalCompletionChars) / 2.5),
          latencyMs,
          toolCallsCount,
          toolsUsed
        });

        yield `event: done\ndata: [DONE]\n\n`;
        return;
      }
    } catch {
      // 雲端連線失敗，自動無縫切換本地沙盒備援
      yield `event: warning\ndata: ${JSON.stringify({
        message: "Zeabur 雲端連線逾時，系統自動無縫切換至本地高擬真備援大腦"
      })}\n\n`;
    }
  }

  // 2. 本地高擬真備援大腦產生器
  const localStream = streamLocalHermesResponse(req.messages, session.activeProject);
  for await (const chunk of localStream) {
    totalCompletionChars += chunk.length;
    yield chunk;
  }

  const latencyMs = Date.now() - startTime;
  recordUsage({
    sessionKey: session.sessionKey,
    profileId: profile.id,
    model: "hermes-local-sandbox",
    promptTokens: Math.ceil(totalPromptChars / 2.5),
    completionTokens: Math.ceil(totalCompletionChars / 2.5),
    totalTokens: Math.ceil((totalPromptChars + totalCompletionChars) / 2.5),
    latencyMs,
    toolCallsCount,
    toolsUsed
  });

  yield `event: done\ndata: [DONE]\n\n`;
}
