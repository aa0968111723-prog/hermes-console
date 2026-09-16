import { z } from "zod";
import { checkOrigin, jsonBody, respond, route } from "@/lib/server/security";
import {
  currentUser,
  destroyOtherSessions,
  destroyOwnedSession,
  destroySession,
  identitiesFor,
  linkEmailIdentity,
  loginEmail,
  membershipFor,
  providerStatus,
  publicUser,
  readCookie,
  redeemMagicLink,
  registerEmail,
  requestMagicLink,
  requestPasswordReset,
  resetPassword,
  sessionHeader,
  sessionsFor,
  verifyEmail,
} from "@/lib/server/identity";
import { emailInput } from "@/lib/server/invitations";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("view") === "providers")
    return respond({ providers: providerStatus() });
  const user = currentUser(req);
  return respond({
    user: publicUser(user),
    membership: membershipFor(user.id),
    identities: identitiesFor(user.id).map((row) => ({
      provider: row.provider,
      email: row.email,
      emailVerified: row.emailVerified,
    })),
    sessions: sessionsFor(user.id, readCookie(req, "hermes_session")),
    providers: providerStatus(),
  });
});

export const POST = route(async (req) => {
  checkOrigin(req);
  const input = z
    .discriminatedUnion("action", [
      z
        .object({
          action: z.literal("register"),
          email: emailInput,
          password: z.string(),
          name: z.string().trim().min(1).max(80),
        })
        .strict(),
      z
        .object({
          action: z.literal("login"),
          email: emailInput,
          password: z.string().min(1).max(200),
        })
        .strict(),
      z
        .object({ action: z.literal("request_link"), email: emailInput })
        .strict(),
      z
        .object({
          action: z.literal("redeem"),
          token: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      z
        .object({
          action: z.literal("verify"),
          token: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      z
        .object({ action: z.literal("forgot"), email: emailInput })
        .strict(),
      z
        .object({
          action: z.literal("reset"),
          token: z.string().regex(/^[a-f0-9]{64}$/),
          password: z.string(),
        })
        .strict(),
      z
        .object({
          action: z.literal("link_email"),
          email: emailInput,
          password: z.string(),
        })
        .strict(),
      z.object({ action: z.literal("revoke_others") }).strict(),
      z
        .object({
          action: z.literal("revoke_session"),
          sessionId: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ])
    .parse(await jsonBody(req, 4000));
  if (input.action === "link_email") {
    const user = currentUser(req);
    const linked = await linkEmailIdentity(user.id, input.email, input.password);
    return respond({
      linked: "email",
      verificationSent: linked.verificationSent,
      user: publicUser(currentUser(req)),
    });
  }
  if (input.action === "revoke_others") {
    destroyOtherSessions(req);
    return respond({ revoked: "others" });
  }
  if (input.action === "revoke_session") {
    destroyOwnedSession(req, input.sessionId);
    return respond({ revoked: "session" });
  }
  if (input.action === "register") {
    const result = await registerEmail(input);
    if (result.token)
      return respond(
        { signedIn: true, first: result.first, user: result.user },
        201,
        { "Set-Cookie": sessionHeader(result.token) },
      );
    return respond(
      { signedIn: false, first: false, message: "請至信箱完成驗證後再登入。" },
      202,
    );
  }
  if (input.action === "login")
    return respond({ signedIn: true }, 200, {
      "Set-Cookie": sessionHeader(loginEmail(input)),
    });
  if (input.action === "request_link")
    return respond(await requestMagicLink(input.email), 202);
  if (input.action === "forgot")
    return respond(await requestPasswordReset(input.email), 202);
  const token =
    input.action === "reset"
      ? resetPassword(input.token, input.password)
      : input.action === "verify"
        ? verifyEmail(input.token)
        : redeemMagicLink(input.token);
  return respond({ signedIn: true }, 200, {
    "Set-Cookie": sessionHeader(token),
  });
});

export const DELETE = route(async (req) => {
  checkOrigin(req);
  destroySession(req);
  return respond({ signedOut: true }, 200, {
    "Set-Cookie": sessionHeader(),
  });
});
