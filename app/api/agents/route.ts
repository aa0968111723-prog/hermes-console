import { z } from "zod";
import {
  ApiError,
  authenticate,
  authenticateOperator,
  isWorkspaceOperator,
  jsonBody,
  respond,
  route,
} from "@/lib/server/security";
import {
  brainVisible,
  capabilityFromHealth,
  listAgentsBestEffort,
  presentAgentProfile,
  saveAgentDiscovery,
} from "@/lib/server/agents";
import { health, healthSnapshot } from "@/lib/server/hermes";
import { aggregateUsage } from "@/lib/server/usage";
import type { Health } from "@/lib/contracts";
export const runtime = "nodejs";

const STORE_UNAVAILABLE = {
  code: "store_unavailable" as const,
  message: "儲存庫無法使用。",
};

const EMPTY_USAGE = {
  byAgent: {} as Record<string, { tokens: number | null; count: number }>,
  averageDurationMs: null as number | null,
};

function rethrowUnlessStoreFailure(error: unknown) {
  if (error instanceof ApiError && error.code !== "store_unavailable") throw error;
  if (error instanceof z.ZodError) throw error;
}

export const GET = route(async (req) => {
  const owner = authenticate(req);
  const operator = isWorkspaceOperator(req);
  try {
    let degraded = false;
    let error = STORE_UNAVAILABLE;
    let connection: Health | null = null;
    try {
      connection = healthSnapshot(owner);
    } catch (caught) {
      rethrowUnlessStoreFailure(caught);
      degraded = true;
    }
    let usage: {
      byAgent: Record<string, { tokens: number | null }>;
      averageDurationMs: number | null;
    } = EMPTY_USAGE;
    try {
      usage = aggregateUsage("30d");
    } catch (caught) {
      rethrowUnlessStoreFailure(caught);
      degraded = true;
    }
    const snapshot = listAgentsBestEffort();
    if (snapshot.degraded) {
      degraded = true;
      if (snapshot.error) error = snapshot.error;
    }
    const agents = snapshot.agents.map((agent) => {
      if (agent.role === "general" && connection?.credential === "valid") {
        const capabilities = capabilityFromHealth(connection);
        return presentAgentProfile(
          {
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
          },
          operator,
        );
      }
      return presentAgentProfile(agent, operator);
    });
    return respond({
      view: operator ? "developer" : "normal",
      agents,
      brain: agents
        .filter(brainVisible)
        .map((agent) => ({ id: agent.id, memorySupport: agent.memorySupport })),
      ...(degraded ? { degraded: true, error } : {}),
    });
  } catch (error) {
    rethrowUnlessStoreFailure(error);
    return respond({
      view: operator ? "developer" : "normal",
      agents: [],
      brain: [],
      degraded: true,
      error: STORE_UNAVAILABLE,
    });
  }
});
export const POST = route(async (req) => {
  const owner = authenticateOperator(req, true);
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
