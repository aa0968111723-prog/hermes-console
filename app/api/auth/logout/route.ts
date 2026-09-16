import { z } from "zod";
import { authenticate, jsonBody, respond, route } from "@/lib/server/security";
import { clearSession, readAccess } from "@/lib/server/auth/session";
import { revokeUserSessions } from "@/lib/server/auth/identity";

export const runtime = "nodejs";

export const DELETE = route(async (request) => {
  authenticate(request, true, { anonymous: true });
  const access = readAccess(request);
  const input = z
    .object({ all: z.boolean().optional() })
    .parse(await jsonBody(request, 200).catch(() => ({})));
  if (input.all && access) revokeUserSessions(access.user.id);
  return respond({ signedOut: true }, 200, { "Set-Cookie": clearSession(request) });
});
