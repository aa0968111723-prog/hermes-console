import { authenticate, jsonBody, respond, route, WORKSPACE_OWNER } from "@/lib/server/security";
import { health } from "@/lib/server/hermes";
import { z } from "zod";
export const runtime = "nodejs";
export const GET = route(async () => {
  const state = await health(WORKSPACE_OWNER);
  return respond({
    ...state,
    live: true,
    ready: state.storeReady,
    agentReady: state.agent === "verified" && state.reachable === true,
  });
});
export const POST = route(async (request) => {
  const owner = authenticate(request, true);
  z.object({})
    .strict()
    .parse(await jsonBody(request));
  return respond(await health(owner, true));
});
