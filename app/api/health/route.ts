import { z } from "zod";
import {
  authenticateOperator,
  isWorkspaceOperator,
  jsonBody,
  respond,
  route,
  WORKSPACE_OWNER,
} from "@/lib/server/security";
import { health } from "@/lib/server/hermes";
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
  const state = await health(WORKSPACE_OWNER);
  return respond(probe(presentHealth(state, isWorkspaceOperator(req))));
});

export const POST = route(async (request) => {
  const owner = authenticateOperator(request, true);
  z.object({}).strict().parse(await jsonBody(request));
  return respond(probe(presentHealth(await health(owner, true), true)));
});
