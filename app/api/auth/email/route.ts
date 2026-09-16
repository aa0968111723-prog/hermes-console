import { z } from "zod";
import {
  ApiError,
  authenticate,
  checkOrigin,
  jsonBody,
  respond,
  route,
} from "@/lib/server/security";
import {
  loginEmail,
  redeemMagicLink,
  registerEmail,
  requestMagicLink,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} from "@/lib/server/auth/providers/email";
import { readAccess } from "@/lib/server/auth/session";
import {
  findIdentity,
  getUser,
  linkIdentity,
  putCredential,
} from "@/lib/server/auth/identity";
import { emailInput } from "@/lib/server/invitations";
import { hashPassword } from "@/lib/server/auth/password";

export const runtime = "nodejs";

export const POST = route(async (request) => {
  authenticate(request, true, { anonymous: true });
  const input = z
    .discriminatedUnion("action", [
      z.object({
        action: z.literal("register"),
        email: emailInput,
        password: z.string().min(10).max(200),
      }),
      z.object({
        action: z.literal("login"),
        email: emailInput,
        password: z.string().min(10).max(200),
      }),
      z.object({ action: z.literal("magic_link"), email: emailInput }),
      z.object({
        action: z.literal("redeem_magic"),
        token: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      z.object({
        action: z.literal("verify_email"),
        token: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      z.object({ action: z.literal("forgot"), email: emailInput }),
      z.object({
        action: z.literal("reset"),
        token: z.string().regex(/^[a-f0-9]{64}$/),
        password: z.string().min(10).max(200),
      }),
      z.object({
        action: z.literal("link_email"),
        email: emailInput,
        password: z.string().min(10).max(200),
      }),
    ])
    .parse(await jsonBody(request, 4000));

  if (input.action === "register") {
    const result = await registerEmail(input.email, input.password);
    return respond(
      {
        signedIn: true,
        emailVerified: result.emailVerified,
        mail: result.mail,
        message: result.message,
      },
      201,
      { "Set-Cookie": result.header },
    );
  }
  if (input.action === "login") {
    const result = await loginEmail(input.email, input.password);
    return respond({ signedIn: true }, 200, { "Set-Cookie": result.header });
  }
  if (input.action === "magic_link")
    return respond(await requestMagicLink(input.email), 202);
  if (input.action === "forgot")
    return respond(await requestPasswordReset(input.email), 202);
  if (input.action === "redeem_magic") {
    const result = redeemMagicLink(input.token);
    return respond({ signedIn: true }, 200, { "Set-Cookie": result.header });
  }
  if (input.action === "verify_email") {
    const result = verifyEmail(input.token);
    return respond({ verified: true }, 200, { "Set-Cookie": result.header });
  }
  if (input.action === "reset") {
    const result = await resetPassword(input.token, input.password);
    return respond({ signedIn: true }, 200, { "Set-Cookie": result.header });
  }
  checkOrigin(request);
  const access = readAccess(request);
  if (!access)
    throw new ApiError(401, "AUTH_ERROR", "請先登入再連結電子信箱。", "AUTH_ERROR");
  const taken = findIdentity("email", input.email);
  if (taken && taken.userId !== access.user.id)
    throw new ApiError(
      409,
      "identity_taken",
      "此電子信箱已連結其他帳號。",
      "AUTH_ERROR",
    );
  linkIdentity(access.user.id, {
    provider: "email",
    subject: input.email,
    email: input.email,
    emailVerified: false,
  });
  putCredential(access.user.id, await hashPassword(input.password));
  const user = getUser(access.user.id)!;
  return respond({ linked: true, email: user.email || input.email });
});
