import { z } from "zod";
import { checkOrigin, jsonBody, respond, route } from "@/lib/server/security";
import { emailInput } from "@/lib/server/invitations";
import {
  authCookie,
  loginEmail,
  redeemMagic,
  registerEmail,
  requestMagicLink,
  requestReset,
  resetPassword,
  verifyEmail,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export const POST = route(async (req) => {
  checkOrigin(req);
  const input = z
    .discriminatedUnion("action", [
      z
        .object({
          action: z.literal("register"),
          email: emailInput,
          password: z.string().min(10).max(200),
          name: z.string().trim().max(80).optional(),
        })
        .strict(),
      z
        .object({
          action: z.literal("login"),
          email: emailInput,
          password: z.string().min(1).max(200),
        })
        .strict(),
      z.object({ action: z.literal("magic_link"), email: emailInput }).strict(),
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
      z.object({ action: z.literal("forgot"), email: emailInput }).strict(),
      z
        .object({
          action: z.literal("reset"),
          token: z.string().regex(/^[a-f0-9]{64}$/),
          password: z.string().min(10).max(200),
        })
        .strict(),
    ])
    .parse(await jsonBody(req, 4000));
  if (input.action === "register") {
    const result = await registerEmail(input, req);
    return respond(
      { message: result.message, signedIn: !!result.token },
      result.token ? 201 : 202,
      result.token ? { "Set-Cookie": authCookie(result.token) } : {},
    );
  }
  if (input.action === "login") {
    const result = loginEmail(input.email, input.password, req);
    return respond({ signedIn: true }, 200, {
      "Set-Cookie": authCookie(result.token),
    });
  }
  if (input.action === "magic_link")
    return respond(await requestMagicLink(input.email), 202);
  if (input.action === "forgot")
    return respond(await requestReset(input.email), 202);
  const result =
    input.action === "redeem"
      ? redeemMagic(input.token, req)
      : input.action === "verify"
        ? verifyEmail(input.token, req)
        : resetPassword(input.token, input.password, req);
  return respond({ signedIn: true }, 200, {
    "Set-Cookie": authCookie(result.token),
  });
});
