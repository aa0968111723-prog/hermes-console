import { checkOrigin, jsonBody, respond, route } from "@/lib/server/security";
import { destroySession, sessionCookie } from "@/lib/server/identity";
import { z } from "zod";

export const runtime = "nodejs";

export const POST = route(async (req) => {
  checkOrigin(req);
  z.object({}).strict().parse(await jsonBody(req, 200));
  destroySession(req);
  return respond({ signedOut: true }, 200, { "Set-Cookie": sessionCookie() });
});
