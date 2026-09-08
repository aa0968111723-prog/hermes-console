import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { testDuigaoConnection } from "@/lib/server/settings";

export const runtime = "nodejs";

export const POST = route(async (request) => {
  authenticate(request, true);
  z.object({ action: z.literal("test") }).strict().parse(await jsonBody(request, 4_000));
  return respond(await testDuigaoConnection());
});
