/**
 * Hermes 用量與效能追蹤中心 (Usage & Observability Center)
 */

export interface UsageEvent {
  id: string;
  timestamp: number;
  sessionKey: string;
  profileId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  toolCallsCount: number;
  toolsUsed: string[];
}

export interface UsageSummary {
  totalCalls: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  avgLatencyMs: number;
  totalToolCalls: number;
  topTools: { tool: string; count: number }[];
  activeSessionsCount: number;
}

const usageHistory: UsageEvent[] = [];
const MAX_HISTORY = 1000;

export function recordUsage(event: Omit<UsageEvent, "id" | "timestamp">): UsageEvent {
  const fullEvent: UsageEvent = {
    ...event,
    id: `usg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now()
  };

  usageHistory.unshift(fullEvent);
  if (usageHistory.length > MAX_HISTORY) {
    usageHistory.pop();
  }

  return fullEvent;
}

export function getUsageSummary(sessionKey?: string): UsageSummary {
  const targetEvents = sessionKey
    ? usageHistory.filter((e) => e.sessionKey === sessionKey)
    : usageHistory;

  if (targetEvents.length === 0) {
    return {
      totalCalls: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      avgLatencyMs: 0,
      totalToolCalls: 0,
      topTools: [],
      activeSessionsCount: 0
    };
  }

  let totalTokens = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalLatency = 0;
  let totalToolCalls = 0;
  const toolCountMap: Record<string, number> = {};
  const sessions = new Set<string>();

  for (const e of targetEvents) {
    totalTokens += e.totalTokens;
    totalPrompt += e.promptTokens;
    totalCompletion += e.completionTokens;
    totalLatency += e.latencyMs;
    totalToolCalls += e.toolCallsCount;
    sessions.add(e.sessionKey);

    for (const tool of e.toolsUsed) {
      toolCountMap[tool] = (toolCountMap[tool] || 0) + 1;
    }
  }

  const topTools = Object.entries(toolCountMap)
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalCalls: targetEvents.length,
    totalTokens,
    totalPromptTokens: totalPrompt,
    totalCompletionTokens: totalCompletion,
    avgLatencyMs: Math.round(totalLatency / targetEvents.length),
    totalToolCalls,
    topTools,
    activeSessionsCount: sessions.size
  };
}

export function listRecentUsageEvents(limit: number = 20, sessionKey?: string): UsageEvent[] {
  if (sessionKey) {
    return usageHistory.filter((e) => e.sessionKey === sessionKey).slice(0, limit);
  }
  return usageHistory.slice(0, limit);
}
