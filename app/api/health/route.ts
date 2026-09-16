import { jsonBody, respond, route, WORKSPACE_OWNER, authenticate } from "@/lib/server/security";
import { health } from "@/lib/server/hermes";
import { z } from "zod";
export const runtime = "nodejs";
/** Liveness/status probe: app + store + Hermes. Never returns secrets. No login. */
export const GET = route(async () => respond(await health(WORKSPACE_OWNER)));
export const POST = route(async (request) => {
  const owner = authenticate(request, true);
  z.object({})
    .strict()
    .parse(await jsonBody(request));
  return respond(await health(owner, true));
});
