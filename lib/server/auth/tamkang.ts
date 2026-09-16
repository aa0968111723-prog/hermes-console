import { randomBytes, createHash } from "node:crypto";
import { get, put, remove } from "../store";
import { ApiError, assertSafeServiceUrl, limited } from "../security";
import { tamkangConfigured } from "./providers";
import { attachIdentity, resolveLoginIdentity } from "./identity";
import { issueSession, requireUser } from "./session";
import type { OAuthState } from "./types";

const SCOPE = "auth";

export type TamkangProtocol = "oidc" | "oauth" | "saml" | "cas";

export function tamkangProtocol(): TamkangProtocol | null {
  const value = (process.env.TAMKANG_SSO_PROTOCOL || "").trim();
  if (value === "oidc" || value === "oauth" || value === "saml" || value === "cas")
    return value;
  return null;
}

type Discovery = {
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
};

async function discover(): Promise<Discovery> {
  const issuer = (process.env.TAMKANG_SSO_ISSUER || "").replace(/\/$/, "");
  const wellKnown = issuer + "/.well-known/openid-configuration";
  assertSafeServiceUrl(wellKnown, "service");
  const response = await fetch(wellKnown, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new ApiError(503, "auth_unconfigured", "淡江 SSO 尚未完成設定");
  return (await response.json()) as Discovery;
}

function redirectUri() {
  return `${(process.env.CONSOLE_ORIGIN || "").replace(/\/$/, "")}/api/auth/tamkang/callback`;
}

function base64url(bytes: Buffer) {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function startTamkang(purpose: "login" | "link", userId?: string) {
  if (!tamkangConfigured())
    throw new ApiError(503, "auth_unconfigured", "淡江 SSO 尚未完成設定");
  const protocol = tamkangProtocol();
  if (protocol === "saml" || protocol === "cas")
    throw new ApiError(503, "auth_unconfigured", "淡江 SSO 尚未完成設定");
  limited("auth:tamkang:start", 20, 15 * 60_000);
  const discovery = await discover();
  if (!discovery.authorization_endpoint || !discovery.token_endpoint)
    throw new ApiError(503, "auth_unconfigured", "淡江 SSO 尚未完成設定");
  assertSafeServiceUrl(discovery.authorization_endpoint, "service");
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = randomBytes(24).toString("hex");
  put("oauth_state", SCOPE, {
    id: state,
    provider: "tamkang",
    verifier,
    purpose,
    userId,
    expires: Date.now() + 10 * 60_000,
    extra: JSON.stringify({
      token: discovery.token_endpoint,
      userinfo: discovery.userinfo_endpoint || "",
    }),
  } as OAuthState & { extra?: string });
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", process.env.TAMKANG_SSO_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function finishTamkang(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const record = get<OAuthState & { extra?: string }>("oauth_state", SCOPE, state);
  remove("oauth_state", SCOPE, state);
  if (!record || record.provider !== "tamkang" || record.expires < Date.now())
    throw new ApiError(401, "invalid_login", "淡江登入已過期，請重試。");
  let endpoints = { token: "", userinfo: "" };
  try {
    endpoints = JSON.parse(record.extra || "{}");
  } catch {
    throw new ApiError(503, "auth_unconfigured", "淡江 SSO 尚未完成設定");
  }
  assertSafeServiceUrl(endpoints.token, "service");
  const body = new URLSearchParams({
    client_id: process.env.TAMKANG_SSO_CLIENT_ID!,
    client_secret: process.env.TAMKANG_SSO_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
    code_verifier: record.verifier,
  });
  const tokenResponse = await fetch(endpoints.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!tokenResponse.ok)
    throw new ApiError(401, "invalid_login", "淡江登入未完成。");
  const tokenJson = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenJson.access_token || !endpoints.userinfo)
    throw new ApiError(401, "invalid_login", "淡江登入未完成。");
  assertSafeServiceUrl(endpoints.userinfo, "service");
  const profileResponse = await fetch(endpoints.userinfo, {
    headers: { Authorization: "Bearer " + tokenJson.access_token },
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!profileResponse.ok)
    throw new ApiError(401, "invalid_login", "淡江登入未完成。");
  const profile = (await profileResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (!profile.sub)
    throw new ApiError(401, "invalid_login", "淡江登入未完成。");
  const identity = {
    provider: "tamkang" as const,
    providerSubject: profile.sub,
    email: profile.email?.toLowerCase() || null,
    emailVerified: !!profile.email_verified,
    name: profile.name || null,
    avatarUrl: profile.picture || null,
  };
  if (record.purpose === "link") {
    if (!record.userId) throw new ApiError(401, "sign_in_required", "請先登入。");
    attachIdentity({ ...identity, userId: record.userId });
    return { token: null as string | null, userId: record.userId };
  }
  const user = resolveLoginIdentity(identity);
  return { token: issueSession(user.id, request), userId: user.id };
}

export async function startTamkangFromRequest(request: Request, purpose: "login" | "link") {
  if (purpose === "link") return startTamkang("link", requireUser(request).id);
  return startTamkang("login");
}
