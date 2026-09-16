import { z } from "zod";
import { checkOrigin, jsonBody, respond, route } from "@/lib/server/security";
import {
  currentMember,
  requestLogin,
  redeemLogin,
  endSession,
  sessionHeader,
  emailInput,
} from "@/lib/server/invitations";
import { optionalUser, publicUser } from "@/lib/server/identity";
import { requestMagicLink, redeemMagicLink } from "@/lib/server/auth-email";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const user = optionalUser(req);
  if (user) return respond({ user: publicUser(user), mode: "identity" });
  const member = currentMember(req);
  return respond({
    member: { email: member.email, role: member.role },
    mode: "email-invitation",
  });
});

export const POST = route(async (req) => {
  checkOrigin(req);
  const input = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("request_link"), email: emailInput }).strict(),
      z
        .object({
          action: z.literal("redeem"),
          token: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ])
    .parse(await jsonBody(req, 2000));
  if (input.action === "request_link") {
    try {
      await requestLogin(input.email);
    } catch {
      /* Invitation mail is optional; identity magic link is the product path. */
    }
    return respond(await requestMagicLink(input.email), 202);
  }
  try {
    const result = redeemMagicLink(input.token);
    return respond({ signedIn: true }, 200, { "Set-Cookie": result.cookie });
  } catch {
    return respond(
      { signedIn: true },
      200,
      { "Set-Cookie": sessionHeader(redeemLogin(input.token)) },
    );
  }
});

export const DELETE = route(async (req) => {
  checkOrigin(req);
  endSession(req);
  return respond({ signedOut: true }, 200, { "Set-Cookie": sessionHeader() });
});
