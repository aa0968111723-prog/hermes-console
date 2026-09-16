import { z } from "zod";
import { checkOrigin, jsonBody, respond, route } from "@/lib/server/security";
import {
  registerWithEmail,
  requestMagicLink,
  requestPasswordReset,
  resetPassword,
  signInWithEmail,
  verifyEmailToken,
} from "@/lib/server/auth-email";

export const runtime = "nodejs";

export const POST = route(async (req) => {
  checkOrigin(req);
  const input = z
    .discriminatedUnion("action", [
      z
        .object({
          action: z.literal("register"),
          email: z.string(),
          password: z.string().min(12).max(200),
          name: z.string().trim().min(1).max(80),
        })
        .strict(),
      z
        .object({
          action: z.literal("login"),
          email: z.string(),
          password: z.string().min(1).max(200),
        })
        .strict(),
      z
        .object({ action: z.literal("magic"), email: z.string() })
        .strict(),
      z
        .object({ action: z.literal("verify"), token: z.string() })
        .strict(),
      z
        .object({ action: z.literal("forgot"), email: z.string() })
        .strict(),
      z
        .object({
          action: z.literal("reset"),
          token: z.string(),
          password: z.string().min(12).max(200),
        })
        .strict(),
    ])
    .parse(await jsonBody(req, 4000));
  if (input.action === "register") {
    const result = await registerWithEmail(input);
    return respond(
      { message: result.message, verified: result.verified, signedIn: result.signedIn },
      result.signedIn ? 201 : 202,
      result.cookie ? { "Set-Cookie": result.cookie } : {},
    );
  }
  if (input.action === "login") {
    const result = signInWithEmail(input.email, input.password);
    return respond({ signedIn: true }, 200, { "Set-Cookie": result.cookie });
  }
  if (input.action === "magic")
    return respond(await requestMagicLink(input.email), 202);
  if (input.action === "verify") {
    const result = verifyEmailToken(input.token);
    return respond({ signedIn: true }, 200, { "Set-Cookie": result.cookie });
  }
  if (input.action === "forgot")
    return respond(await requestPasswordReset(input.email), 202);
  const result = resetPassword(input.token, input.password);
  return respond({ signedIn: true }, 200, { "Set-Cookie": result.cookie });
});
