import { authenticate, respond, route } from "@/lib/server/security";
import { brainVisible, capabilityFromHealth, listAgents } from "@/lib/server/agents";
import { health } from "@/lib/server/hermes";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  const owner = authenticate(req);
  const connection = await health(owner);
  const general = {
    ...listAgents().find((agent) => agent.id === "general")!,
    capabilities: capabilityFromHealth(connection),
    memorySupport: capabilityFromHealth(connection).memory,
    sessionSupport: capabilityFromHealth(connection).sessions,
  };
  if (!brainVisible(general))
    return respond({
      supported: false,
      reason: "目前 Hermes 實例未宣告 memory／session_search；不顯示 Agent Brain。",
    });
  return respond({
    supported: true,
    longTerm: null,
    project: null,
    sessions: connection.features.session_resources ? [] : null,
    notice: "內容來自 Hermes 實例能力，不是 Console 假記憶。",
  });
});
