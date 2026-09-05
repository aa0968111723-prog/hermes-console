import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { health } from "@/lib/server/hermes";
import { z } from "zod";
export const runtime = "nodejs";
export const GET = route(async (request) =>
  respond(await health(authenticate(request))),
);
export const POST = route(async (request) => {
  const owner = authenticate(request, true);
  z.object({})
    .strict()
    .parse(await jsonBody(request));
  return respond(await health(owner, true));
});
