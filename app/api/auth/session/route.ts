import { hash, respond, route } from "@/lib/server/security";
import {
  optionalUser,
  publicUser,
  membershipFor,
  listSessions,
  parseSessionToken,
} from "@/lib/server/identity";
import { authProviderFlags } from "@/lib/server/env";
import { tamkangAuthStatus } from "@/lib/server/auth-tamkang";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const user = optionalUser(req);
  const token = parseSessionToken(req);
  return respond({
    user: user ? publicUser(user) : null,
    membership: user ? membershipFor(user.id)?.role || null : null,
    sessions: user ? listSessions(user.id, token ? hash(token) : "") : [],
    providers: {
      ...authProviderFlags(),
      tamkang: tamkangAuthStatus(),
    },
  });
});
