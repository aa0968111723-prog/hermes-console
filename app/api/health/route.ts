import { authenticate, hasValidSession, jsonBody, respond, route } from "@/lib/server/security";
import { health } from "@/lib/server/hermes";
import { publicHealthStatus } from "@/lib/server/health-public";
import { isAuthRequired } from "@/lib/server/auth/mode";
import { z } from "zod";
export const runtime = "nodejs";
export const GET = route(async (request) => {
  const owner = authenticate(request, false, { anonymous: true });
  if (isAuthRequired() && !hasValidSession(request)) {
    return respond(publicHealthStatus(owner));
  }
  return respond(await health(owner));
});
export const POST = route(async (request) => {
  const owner = authenticate(request, true);
  z.object({})
    .strict()
    .parse(await jsonBody(request));
  return respond(await health(owner, true));
});
