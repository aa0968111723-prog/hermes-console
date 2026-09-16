import { authPublicState } from "@/lib/server/auth/mode";
import { readAccess, sessionPayload } from "@/lib/server/auth/session";
import { authenticate, respond, route } from "@/lib/server/security";

export const runtime = "nodejs";

export const GET = route(async (request) => {
  authenticate(request, false, { anonymous: true });
  const access = readAccess(request);
  const publicState = authPublicState();
  if (!access)
    return respond({
      ...publicState,
      user: null,
      membership: null,
      identities: [],
      providers: { google: false, tamkang: false, email: false },
    });
  return respond({
    ...publicState,
    ...sessionPayload(access.user, access.membership),
  });
});
