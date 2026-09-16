import { jsonBody, respond, route, WORKSPACE_OWNER } from "@/lib/server/security";
import { health } from "@/lib/server/hermes";
import { authenticate } from "@/lib/server/security";
import { z } from "zod";
export const runtime = "nodejs";
export const GET = route(async () => {
  const state = await health(WORKSPACE_OWNER);
  return respond({
    ...state,
    live: true,
    ready: state.storeReady,
    agentReady:
      state.reachable === true && state.credential === "valid",
  });
});
export const POST = route(async (request) => {
  const owner = authenticate(request, true);
  z.object({}).strict().parse(await jsonBody(request));
  return respond(await health(owner, true));
});
