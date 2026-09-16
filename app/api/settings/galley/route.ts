import { z } from "zod";
import { jsonBody, respond, route } from "@/lib/server/security";
import { testGalleyConnection } from "@/lib/server/settings";
import { requireSettingsWrite } from "@/lib/server/auth/settings-write";

export const runtime = "nodejs";

export const POST = route(async (request) => {
  requireSettingsWrite(request);
  const body = z
    .object({ action: z.literal("test") })
    .strict()
    .parse(await jsonBody(request, 8_000));
  void body;
  return respond(await testGalleyConnection());
});
