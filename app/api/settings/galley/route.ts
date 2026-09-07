import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { testGalleyConnection } from "@/lib/server/settings";

export const runtime = "nodejs";

export const POST = route(async (request) => {
  authenticate(request, true);
  const body = z
    .object({ action: z.literal("test") })
    .strict()
    .parse(await jsonBody(request, 8_000));
  void body;
  return respond(await testGalleyConnection());
});
