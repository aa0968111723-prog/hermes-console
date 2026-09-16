import { randomBytes, createHash } from "node:crypto";
import { put, get, remove } from "../store";
import { ApiError, limited } from "../security";
import { googleConfigured } from "./providers";
import { attachIdentity, resolveLoginIdentity } from "./identity";
import { issueSession, requireUser } from "./session";
import type { OAuthState } from "./types";

const SCOPE = "auth";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

function redirectUri() {
  const origin = process.env.GOOGLE_REDIRECT_URI?.trim() ||
    `${(process.env.CONSOLE_ORIGIN || "").replace(/\/$/, "")}/api/auth/google/callback`;
  const url = new URL(origin);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1")
    throw new ApiError(503, "auth_unconfigured", "Google 登入尚未完成設定");
  return url.toString();
}

function base64url(bytes: Buffer) {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function startGoogle(purpose: "login" | "link", userId?: string) {
  if (!googleConfigured())
    throw new ApiError(503, "auth_unconfigured", "Google 登入尚未完成設定");
  limited("auth:google:start", 30, 15 * 60_000);
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = randomBytes(24).toString("hex");
  put("oauth_state", SCOPE, {
    id: state,
    provider: "google",
    verifier,
    purpose,
    userId,
    expires: Date.now() + 10 * 60_000,
  } satisfies OAuthState);
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

async function exchangeGoogle(code: string, verifier: string) {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!tokenResponse.ok)
    throw new ApiError(401, "invalid_login", "Google 登入未完成。");
  const tokenJson = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenJson.access_token)
    throw new ApiError(401, "invalid_login", "Google 登入未完成。");
  const profileResponse = await fetch(USERINFO_URL, {
    headers: { Authorization: "Bearer " + tokenJson.access_token },
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!profileResponse.ok)
    throw new ApiError(401, "invalid_login", "Google 登入未完成。");
  const profile = (await profileResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (!profile.sub)
    throw new ApiError(401, "invalid_login", "Google 登入未完成。");
  return {
    provider: "google" as const,
    providerSubject: profile.sub,
    email: profile.email?.toLowerCase() || null,
    emailVerified: !!profile.email_verified,
    name: profile.name || null,
    avatarUrl: profile.picture || null,
  };
}

export async function finishGoogle(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const record = get<OAuthState>("oauth_state", SCOPE, state);
  remove("oauth_state", SCOPE, state);
  if (!record || record.provider !== "google" || record.expires < Date.now())
    throw new ApiError(401, "invalid_login", "Google 登入已過期，請重試。");
  const profile = await exchangeGoogle(code, record.verifier);
  if (record.purpose === "link") {
    if (!record.userId) throw new ApiError(401, "sign_in_required", "請先登入。");
    attachIdentity({ ...profile, userId: record.userId });
    return { token: null as string | null, userId: record.userId };
  }
  const user = resolveLoginIdentity(profile);
  return { token: issueSession(user.id, request), userId: user.id };
}

export function startGoogleFromRequest(request: Request, purpose: "login" | "link") {
  if (purpose === "link") return startGoogle("link", requireUser(request).id);
  return startGoogle("login");
}
