import { ApiError, authenticate, respond, route } from "@/lib/server/security";
import {
  brainVisible,
  capabilityFromHealth,
  defaultProfiles,
  listAgentsBestEffort,
} from "@/lib/server/agents";
import { health } from "@/lib/server/hermes";
export const runtime = "nodejs";

const STORE_UNAVAILABLE = {
  code: "store_unavailable" as const,
  message: "儲存庫無法使用。",
};

const BRAIN_UNAVAILABLE_REASON = "目前無法讀取 Agent Brain。";
const BRAIN_UNSUPPORTED_REASON =
  "目前 Hermes 實例未宣告 memory／session_search；不顯示 Agent Brain。";

function rethrowUnlessStoreFailure(error: unknown) {
  if (error instanceof ApiError && error.code !== "store_unavailable") throw error;
}

export const GET = route(async (req) => {
  const owner = authenticate(req);
  try {
    const connection = await health(owner);
    const snapshot = listAgentsBestEffort();
    const generalAgent =
      snapshot.agents.find((agent) => agent.id === "general") ||
      defaultProfiles().find((agent) => agent.id === "general");
    if (!generalAgent) {
      return respond({
        supported: false,
        degraded: true,
        reason: BRAIN_UNAVAILABLE_REASON,
        error: STORE_UNAVAILABLE,
      });
    }
    const capabilities = capabilityFromHealth(connection);
    const general = {
      ...generalAgent,
      capabilities,
      memorySupport: capabilities.memory,
      sessionSupport: capabilities.sessions,
    };
    if (!brainVisible(general))
      return respond({
        supported: false,
        reason: BRAIN_UNSUPPORTED_REASON,
        ...(snapshot.degraded
          ? { degraded: true, error: snapshot.error || STORE_UNAVAILABLE }
          : {}),
      });
    return respond({
      supported: true,
      longTerm: null,
      project: null,
      sessions: connection.features.session_resources ? [] : null,
      notice: "內容來自 Hermes 實例能力，不是 Console 假記憶。",
      ...(snapshot.degraded
        ? { degraded: true, error: snapshot.error || STORE_UNAVAILABLE }
        : {}),
    });
  } catch (error) {
    rethrowUnlessStoreFailure(error);
    return respond({
      supported: false,
      degraded: true,
      reason: BRAIN_UNAVAILABLE_REASON,
      error: STORE_UNAVAILABLE,
    });
  }
});
