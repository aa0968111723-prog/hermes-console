import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { exchangeTamkangLogin, testTamkangConnection } from "@/lib/server/settings";

export const runtime = "nodejs";

export const POST = route(async (request) => {
  authenticate(request, true);
  const body = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("test") }).strict(),
      z
        .object({
          action: z.literal("login"),
          username: z.string().min(1).max(120),
          password: z.string().min(1).max(200),
        })
        .strict(),
    ])
    .parse(await jsonBody(request, 8_000));
  if (body.action === "test") return respond(await testTamkangConnection());
  return respond(await exchangeTamkangLogin(body.username, body.password));
});
