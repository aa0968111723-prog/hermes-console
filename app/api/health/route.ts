import { jsonBody, respond, route, WORKSPACE_OWNER, authenticate } from "@/lib/server/security";
import { health, liveHealth } from "@/lib/server/hermes";
import { z } from "zod";
export const runtime = "nodejs";
/** Liveness: app + store + last known Hermes status. Never waits on upstream. No secrets. */
export const GET = route(async () => respond(liveHealth(WORKSPACE_OWNER)));
export const POST = route(async (request) => {
  const owner = authenticate(request, true);
  z.object({})
    .strict()
    .parse(await jsonBody(request));
  return respond(await health(owner, true));
});
