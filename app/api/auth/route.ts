import { z } from "zod";
import { authenticate, checkOrigin, jsonBody, respond, route } from "@/lib/server/security";
import { currentMember, requestLogin, redeemLogin, endSession, sessionHeader, emailInput } from "@/lib/server/invitations";
export const runtime = "nodejs";
export const GET = route(async req => {
  authenticate(req);
  const member = currentMember(req);
  return respond({ member: { email: member.email, role: member.role }, mode: "email-invitation" });
});
export const POST = route(async req => {
  checkOrigin(req);
  const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("request_link"), email: emailInput }).strict(),
    z.object({ action: z.literal("redeem"), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  ]).parse(await jsonBody(req, 2000));
  if (input.action === "request_link") return respond(await requestLogin(input.email), 202);
  return respond({ signedIn: true }, 200, { "Set-Cookie": sessionHeader(redeemLogin(input.token)) });
});
export const DELETE = route(async req => {
  checkOrigin(req); endSession(req);
  return respond({ signedOut: true }, 200, { "Set-Cookie": sessionHeader() });
});
