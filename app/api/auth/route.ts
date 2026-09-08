import { z } from "zod";
import { authenticate, checkOrigin, endOwnerSession, jsonBody, login, ownerLoginEnabled, respond, route, sessionCookie } from "@/lib/server/security";
import { currentMember, requestLogin, redeemLogin, endSession, sessionHeader, emailInput } from "@/lib/server/invitations";
export const runtime = "nodejs";
const ownerInput = z.object({ username: z.string().min(1).max(128), password: z.string().min(1).max(256) }).strict();
export const GET = route(async req => {
  if (ownerLoginEnabled()) {
    try {
      authenticate(req);
      return respond({ signedIn: true, mode: "owner-login" });
    } catch {
      return respond({ signedIn: false, mode: "owner-login" }, 401);
    }
  }
  authenticate(req);
  const member = currentMember(req);
  return respond({ member: { email: member.email, role: member.role }, mode: "email-invitation" });
});
export const POST = route(async req => {
  checkOrigin(req);
  if (ownerLoginEnabled()) {
    const input = z.object({ action: z.literal("owner_login") }).strict()
      .and(ownerInput).parse(await jsonBody(req, 2000));
    return respond({ signedIn: true }, 200, { "Set-Cookie": sessionCookie(login(input.username, input.password)) });
  }
  const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("request_link"), email: emailInput }).strict(),
    z.object({ action: z.literal("redeem"), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  ]).parse(await jsonBody(req, 2000));
  if (input.action === "request_link") return respond(await requestLogin(input.email), 202);
  return respond({ signedIn: true }, 200, { "Set-Cookie": sessionHeader(redeemLogin(input.token)) });
});
export const DELETE = route(async req => {
  checkOrigin(req);
  if (ownerLoginEnabled()) {
    endOwnerSession(req);
    return respond({ signedOut: true }, 200, { "Set-Cookie": sessionCookie("", true) });
  }
  endSession(req);
  return respond({ signedOut: true }, 200, { "Set-Cookie": sessionHeader() });
});
