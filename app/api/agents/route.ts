import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import {
  brainVisible,
  capabilityFromHealth,
  listAgents,
  publicProfile,
  saveAgentDiscovery,
} from "@/lib/server/agents";
import { health } from "@/lib/server/hermes";
import { aggregateUsage } from "@/lib/server/usage";
export const runtime = "nodejs";
export const GET = route(async (req) => {
  const owner = authenticate(req);
  const connection = await health(owner);
  const usage = aggregateUsage("30d");
  const agents = listAgents().map((agent) => {
    if (agent.role === "general" && connection.credential === "valid") {
      const capabilities = capabilityFromHealth(connection);
      return publicProfile({
        ...agent,
        status: connection.reachable ? "reachable" : "configured",
        reachable: connection.reachable,
        capabilities,
        skills: connection.skills,
        toolsets: connection.toolsets,
        tools: connection.toolsets.flatMap((item) => item.tools || []),
        memorySupport: capabilities.memory,
        sessionSupport: capabilities.sessions,
        runsSupport: capabilities.runs,
        lastVerifiedAt: connection.checkedAt,
        lastError: connection.status === "failed" ? connection.message : null,
        usage: {
          totalTokens:
            (usage.byAgent.general?.tokens as number | null) ?? null,
          durationMs: usage.averageDurationMs,
        },
        model: connection.models[0] || agent.model,
      });
    }
    return publicProfile(agent);
  });
  return respond({
    agents,
    brain: agents
      .filter(brainVisible)
      .map((agent) => ({ id: agent.id, memorySupport: agent.memorySupport })),
  });
});
export const POST = route(async (req) => {
  const owner = authenticate(req, true);
  z.object({ refresh: z.literal(true) })
    .strict()
    .parse(await jsonBody(req));
  const connection = await health(owner, true);
  const capabilities = capabilityFromHealth(connection);
  saveAgentDiscovery("general", {
    capabilities,
    skills: connection.skills,
    toolsets: connection.toolsets,
    memorySupport: capabilities.memory,
    sessionSupport: capabilities.sessions,
    runsSupport: capabilities.runs,
    lastVerifiedAt: connection.checkedAt,
    reachable: connection.reachable,
    status: connection.reachable ? "reachable" : "failed",
  });
  return respond({ ok: true, health: connection });
});
