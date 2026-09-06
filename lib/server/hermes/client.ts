import { HERMES_DEFAULTS } from "../integrations/truth-status";
import { HERMES_TOOLS, executeHermesTool } from "./tools";
import { streamLocalHermesResponse, type ChatMessage } from "./local-brain";
import { getAgentProfile, type AgentProfile } from "./registry.ts";
import { getOrCreateSessionContext, type SessionContext } from "./session.ts";
import { recordUsage } from "./usage.ts";
import { searchMemories } from "./memory.ts";
import { readHermesCredential, resolveHermesTarget } from "./target.ts";

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

  const target = resolveHermesTarget(req.profileId);
  const base = target.ok ? target.baseUrl : "";
  const key = target.ok ? readHermesCredential(target.credentialReference) : "";
  const model = req.model || process.env.HERMES_MODEL || HERMES_DEFAULTS.DEFAULT_MODEL;

  const toolsForProfile = HERMES_TOOLS.filter((t) => profile.allowedTools.includes(t.function.name));

  let totalCompletionChars = 0;
  let toolCallsCount = 0;
  const toolsUsed: string[] = [];

  // 發送初始狀態事件
  yield `event: status\ndata: ${JSON.stringify({
    profile: profile.id,
    profileName: profile.name,
    profileKind: profile.kind || "console_role",
    hermesTarget: {
      ok: target.ok,
      kind: target.kind,
      profilePath: target.profilePath || null,
      credentialReference: target.credentialReference,
      fallbackUsed: target.fallbackUsed,
      error: target.error || null,
    },
    sessionKey: session.sessionKey,
    activeProject: session.activeProject,
    engine: !req.forceLocal && base && key ? "zeabur_cloud" : "local_brain"
  })}\n\n`;

  if (target.error && target.fallbackUsed) {
    yield `event: warning\ndata: ${JSON.stringify({
      message: target.error,
    })}\n\n`;
  }

  // 1. 若設定了有效網域且未強制本地，嘗試請求 Zeabur
  if (!req.forceLocal && base && key) {
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
          stream_options: { include_usage: true },
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
        let sseBuffer = "";
        let reportedPromptTokens = 0;
        let reportedCompletionTokens = 0;
        const accumulatedToolCalls = new Map<number, { id: string; name: string; args: string }>();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          sseBuffer += chunk;
          totalCompletionChars += chunk.length;

          // 嘗試解析 SSE 內部是否有 tool_calls 或 usage
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                if (parsed.usage) {
                  if (typeof parsed.usage.prompt_tokens === "number") {
                    reportedPromptTokens = parsed.usage.prompt_tokens;
                  }
                  if (typeof parsed.usage.completion_tokens === "number") {
                    reportedCompletionTokens = parsed.usage.completion_tokens;
                  }
                }
                const deltaToolCalls = parsed.choices?.[0]?.delta?.tool_calls;
                if (Array.isArray(deltaToolCalls)) {
                  for (const dtc of deltaToolCalls) {
                    const idx = dtc.index ?? 0;
                    const existing = accumulatedToolCalls.get(idx) || { id: "", name: "", args: "" };
                    if (dtc.id) existing.id = dtc.id;
                    if (dtc.function?.name) existing.name = dtc.function.name;
                    if (dtc.function?.arguments) existing.args += dtc.function.arguments;
                    accumulatedToolCalls.set(idx, existing);
                  }
                }
              } catch {
                // 非標準 JSON 或心跳 chunk 忽略
              }
            }
          }

          // 直通轉發 SSE chunk
          yield chunk;
        }

        // 若模型在串流中發起了工具呼叫，在伺服器端執行並回傳 tool_result 事件
        if (accumulatedToolCalls.size > 0) {
          for (const [, tc] of accumulatedToolCalls) {
            if (tc.name) {
              toolCallsCount++;
              if (!toolsUsed.includes(tc.name)) {
                toolsUsed.push(tc.name);
              }
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = tc.args ? JSON.parse(tc.args) : {};
              } catch {
                parsedArgs = { raw: tc.args };
              }

              yield `event: status\ndata: ${JSON.stringify({
                message: `正在執行工具調用: ${tc.name}...`,
                tool: tc.name
              })}\n\n`;

              const toolRes = await executeHermesTool(tc.name, parsedArgs);
              yield `event: tool_result\ndata: ${JSON.stringify({
                id: tc.id,
                name: tc.name,
                result: toolRes.result,
                summary: toolRes.summary
              })}\n\n`;
            }
          }
        }

        // 記錄用量（若上游回報真實 Usage 則優先採用）
        const latencyMs = Date.now() - startTime;
        const hasUpstreamUsage = reportedPromptTokens > 0 || reportedCompletionTokens > 0;
        recordUsage({
          sessionKey: session.sessionKey,
          profileId: profile.id,
          agent: profile.id,
          project: session.activeProject,
          model,
          promptTokens: hasUpstreamUsage ? reportedPromptTokens : null,
          completionTokens: hasUpstreamUsage ? reportedCompletionTokens : null,
          totalTokens: hasUpstreamUsage ? reportedPromptTokens + reportedCompletionTokens : null,
          latencyMs,
          toolCallsCount,
          toolErrors: 0,
          toolsUsed,
          tokenSource: hasUpstreamUsage ? "upstream" : "unavailable"
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
    if (chunk.includes("<tool_call>")) {
      toolCallsCount++;
      const match = chunk.match(/"name":\s*"([^"]+)"/);
      if (match && match[1] && !toolsUsed.includes(match[1])) {
        toolsUsed.push(match[1]);
      }
    }
    yield chunk;
  }

  const latencyMs = Date.now() - startTime;
  recordUsage({
    sessionKey: session.sessionKey,
    profileId: profile.id,
    agent: profile.id,
    project: session.activeProject,
    model: "hermes-local-sandbox",
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    latencyMs,
    toolCallsCount,
    toolErrors: 0,
    toolsUsed,
    tokenSource: "unavailable"
  });

  yield `event: done\ndata: [DONE]\n\n`;
}
