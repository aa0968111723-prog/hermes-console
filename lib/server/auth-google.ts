import { createHash, randomBytes } from "node:crypto";
import { ApiError, assertSafeServiceUrl } from "./security";
import {
  completeExternalLogin,
  consumeOAuthState,
  issueSession,
  putOAuthState,
  sessionCookie,
} from "./identity";

function googleConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

function redirectUri() {
  const origin = new URL(process.env.CONSOLE_ORIGIN || "").origin;
  return origin + "/api/auth/google/callback";
}

export function googleStart(linkUserId?: string | null) {
  if (!googleConfigured())
    throw new ApiError(
      503,
      "oauth_unconfigured",
      "Google 登入尚未完成設定。",
    );
  assertSafeServiceUrl("https://accounts.google.com/o/oauth2/v2/auth", "service");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = putOAuthState({
    provider: "google",
    verifier,
    linkUserId,
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!.trim());
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function googleCallback(url: URL) {
  if (!googleConfigured())
    throw new ApiError(
      503,
      "oauth_unconfigured",
      "Google 登入尚未完成設定。",
    );
  const error = url.searchParams.get("error");
  if (error)
    throw new ApiError(401, "oauth_failed", "Google 登入未完成。");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const stored = consumeOAuthState("google", state);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
      code_verifier: stored.verifier,
    }),
  });
  const tokens = (await tokenResponse.json().catch(() => ({}))) as {
    access_token?: string;
    id_token?: string;
  };
  if (!tokenResponse.ok || !tokens.access_token)
    throw new ApiError(401, "oauth_failed", "Google 登入未完成。");
  const profileResponse = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: "Bearer " + tokens.access_token },
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    },
  );
  const profile = (await profileResponse.json().catch(() => ({}))) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (!profileResponse.ok || !profile.sub)
    throw new ApiError(401, "oauth_failed", "Google 登入未完成。");
  const user = completeExternalLogin({
    provider: "google",
    subject: profile.sub,
    email: profile.email || null,
    emailVerified: profile.email_verified === true,
    name: profile.name || "Google 使用者",
    avatar: profile.picture || null,
    linkUserId: stored.linkUserId,
  });
  return { cookie: sessionCookie(issueSession(user.id)) };
}
