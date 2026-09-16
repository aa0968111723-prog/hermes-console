import { createHash, randomBytes } from "node:crypto";
import { ApiError, limited } from "../../security";
import { googleConfigured } from "../mode";
import {
  createUser,
  findIdentity,
  getUser,
  linkIdentity,
  putAuthToken,
  consumeAuthToken,
  saveUser,
} from "../identity";
import { issueSession } from "../session";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const INFO = "https://oauth2.googleapis.com/tokeninfo";

function origin() {
  try {
    return new URL(process.env.CONSOLE_ORIGIN || "").origin;
  } catch {
    throw new ApiError(503, "setup_required", "後端尚未設定 CONSOLE_ORIGIN。");
  }
}

function redirectUri() {
  return origin() + "/api/auth/google/callback";
}

function challenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function startGoogleAuth(userId?: string) {
  if (!googleConfigured())
    throw new ApiError(
      503,
      "AUTH_ERROR",
      "Google 登入尚未完成設定。",
      "AUTH_ERROR",
    );
  limited("oauth:google:start", 30, 15 * 60_000);
  const state = randomBytes(24).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  putAuthToken(state, {
    userId: userId || "",
    purpose: "oauth_state",
    expiresAt: Date.now() + 10 * 60_000,
    used: false,
    payload: { nonce, verifier, provider: "google" },
  });
  const url = new URL(AUTH);
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function handleGoogleCallback(url: URL, userId?: string) {
  if (!googleConfigured())
    throw new ApiError(
      503,
      "AUTH_ERROR",
      "Google 登入尚未完成設定。",
      "AUTH_ERROR",
    );
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !/^[a-f0-9]{48}$/.test(state))
    throw new ApiError(401, "AUTH_ERROR", "Google 回呼無效。", "AUTH_ERROR");
  const record = consumeAuthToken(state);
  if (record.purpose !== "oauth_state" || record.payload?.provider !== "google")
    throw new ApiError(401, "AUTH_ERROR", "Google 回呼已失效。", "AUTH_ERROR");
  const verifier = record.payload?.verifier || "";
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  const tokenResponse = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const tokens = (await tokenResponse.json().catch(() => ({}))) as {
    id_token?: string;
  };
  if (!tokenResponse.ok || typeof tokens.id_token !== "string")
    throw new ApiError(401, "AUTH_ERROR", "Google 授權未完成。", "AUTH_ERROR");
  const infoResponse = await fetch(
    INFO + "?id_token=" + encodeURIComponent(tokens.id_token),
    { redirect: "error", signal: AbortSignal.timeout(10_000) },
  );
  const profile = (await infoResponse.json().catch(() => ({}))) as {
    sub?: string;
    email?: string;
    email_verified?: string | boolean;
    name?: string;
    picture?: string;
    aud?: string;
    nonce?: string;
  };
  if (
    !infoResponse.ok ||
    profile.aud !== process.env.GOOGLE_CLIENT_ID ||
    profile.nonce !== record.payload?.nonce ||
    !profile.sub
  )
    throw new ApiError(401, "AUTH_ERROR", "Google 身分無法驗證。", "AUTH_ERROR");
  const existing = findIdentity("google", profile.sub);
  const actor = userId || record.userId;
  let user = actor ? getUser(actor) : existing ? getUser(existing.userId) : null;
  if (actor && existing && existing.userId !== actor)
    throw new ApiError(
      409,
      "identity_taken",
      "此 Google 帳號已連結其他使用者。",
      "AUTH_ERROR",
    );
  if (!user) {
    user = createUser({
      email: profile.email || null,
      emailVerified: profile.email_verified === true || profile.email_verified === "true",
      name: profile.name || "Google 使用者",
      avatar: profile.picture || null,
    });
  } else if (!user.avatar && profile.picture) {
    saveUser({ ...user, avatar: profile.picture, name: user.name || profile.name || user.name });
  }
  linkIdentity(user.id, {
    provider: "google",
    subject: profile.sub,
    email: profile.email || null,
    emailVerified: profile.email_verified === true || profile.email_verified === "true",
    name: profile.name || null,
    avatar: profile.picture || null,
  });
  return issueSession(user.id);
}
