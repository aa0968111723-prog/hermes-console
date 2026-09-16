import { z } from "zod";
import { checkOrigin, jsonBody, respond, route } from "@/lib/server/security";
import {
  currentSessionDigest,
  listAuthSessions,
  requireUser,
  revokeAuthSession,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const user = requireUser(req);
  return respond({
    sessions: listAuthSessions(user.id, currentSessionDigest(req)),
  });
});

export const DELETE = route(async (req) => {
  checkOrigin(req);
  const user = requireUser(req);
  const input = z
    .object({ id: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict()
    .parse(await jsonBody(req, 500));
  revokeAuthSession(user.id, input.id, currentSessionDigest(req));
  return respond({ revoked: true });
});
