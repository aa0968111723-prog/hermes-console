import { z } from "zod";
import {
  authenticateOperator,
  isWorkspaceOperator,
  jsonBody,
  respond,
  route,
  WORKSPACE_OWNER,
} from "@/lib/server/security";
import { health, healthSnapshot } from "@/lib/server/hermes";
import { presentHealth } from "@/lib/server/hermes/health-view";
import type { Health } from "@/lib/contracts";

export const runtime = "nodejs";

function probe(state: Health) {
  return {
    ...state,
    live: true,
    ready: state.storeReady,
    agentReady: state.reachable === true && state.credential === "valid",
  };
}

export const GET = route(async (req) => {
  try {
    const operator = isWorkspaceOperator(req);
    return respond(probe(presentHealth(healthSnapshot(WORKSPACE_OWNER), operator)));
  } catch {
    return respond(
      probe({
        checkedAt: new Date().toISOString(),
        reachable: null,
        credential: "unknown",
        agent: "unverified",
        status: "unconfigured",
        message: "儲存庫無法使用。",
        httpStatus: null,
        features: {},
        models: [],
        skills: [],
        toolsets: [],
        discovery: {},
        backend: "sqlite",
        dataDir: "",
        storeReady: false,
      }),
    );
  }
});

export const POST = route(async (request) => {
  const owner = authenticateOperator(request, true);
  z.object({}).strict().parse(await jsonBody(request));
  return respond(probe(presentHealth(await health(owner, true), true)));
});
