import { createHash, randomBytes } from "node:crypto";
import { ApiError, assertSafeServiceUrl } from "./security";
import { tamkangConfigured } from "./env";
import {
  completeExternalLogin,
  consumeOAuthState,
  issueSession,
  putOAuthState,
  sessionCookie,
} from "./identity";

export type TamkangProtocol = "oidc" | "oauth" | "saml" | "cas";

export function tamkangAuthStatus() {
  const protocol = (
    process.env.TAMKANG_SSO_PROTOCOL || "oidc"
  ).toLowerCase() as TamkangProtocol;
  if (protocol === "saml" || protocol === "cas")
    return {
      configured: false,
      protocol,
      message:
        "淡江 SSO 尚未完成設定（" +
        protocol.toUpperCase() +
        " 適配器尚未接入校方中繼資料）。",
    };
  if (!tamkangConfigured())
    return {
      configured: false,
      protocol,
      message: "淡江 SSO 尚未完成設定",
    };
  return {
    configured: true,
    protocol,
    message: "將跳轉淡江正式 Identity Provider。Hermes 不會要求學校密碼。",
  };
}

function redirectUri() {
  return new URL(process.env.CONSOLE_ORIGIN || "").origin +
    "/api/auth/tamkang/callback";
}

async function discovery() {
  const metadata = process.env.TAMKANG_SSO_METADATA_URL?.trim();
  const issuer = process.env.TAMKANG_SSO_ISSUER?.trim();
  const authorize = process.env.TAMKANG_SSO_AUTHORIZE_URL?.trim();
  const token = process.env.TAMKANG_SSO_TOKEN_URL?.trim();
  const userinfo = process.env.TAMKANG_SSO_USERINFO_URL?.trim();
  if (authorize && token)
    return {
      authorization_endpoint: authorize,
      token_endpoint: token,
      userinfo_endpoint: userinfo || "",
    };
  const source = metadata || (issuer ? issuer.replace(/\/$/, "") + "/.well-known/openid-configuration" : "");
  if (!source)
    throw new ApiError(503, "tamkang_unconfigured", "淡江 SSO 尚未完成設定");
  assertSafeServiceUrl(source, "service");
  const response = await fetch(source, {
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    authorization_endpoint?: string;
    token_endpoint?: string;
    userinfo_endpoint?: string;
  };
  if (
    !response.ok ||
    !body.authorization_endpoint ||
    !body.token_endpoint
  )
    throw new ApiError(503, "tamkang_unconfigured", "淡江 SSO 尚未完成設定");
  assertSafeServiceUrl(body.authorization_endpoint, "service");
  assertSafeServiceUrl(body.token_endpoint, "service");
  if (body.userinfo_endpoint)
    assertSafeServiceUrl(body.userinfo_endpoint, "service");
  return body;
}

export async function tamkangStart(linkUserId?: string | null) {
  const status = tamkangAuthStatus();
  if (!status.configured)
    throw new ApiError(503, "tamkang_unconfigured", status.message);
  const endpoints = await discovery();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = putOAuthState({
    provider: "tamkang",
    verifier,
    linkUserId,
  });
  const url = new URL(endpoints.authorization_endpoint!);
  url.searchParams.set("client_id", process.env.TAMKANG_SSO_CLIENT_ID!.trim());
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", process.env.TAMKANG_SSO_SCOPE?.trim() || "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function tamkangCallback(url: URL) {
  const status = tamkangAuthStatus();
  if (!status.configured)
    throw new ApiError(503, "tamkang_unconfigured", status.message);
  if (url.searchParams.get("error"))
    throw new ApiError(401, "oauth_failed", "淡江登入未完成。");
  const stored = consumeOAuthState("tamkang", url.searchParams.get("state") || "");
  const endpoints = await discovery();
  const tokenResponse = await fetch(endpoints.token_endpoint!, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.TAMKANG_SSO_CLIENT_ID!.trim(),
      client_secret: process.env.TAMKANG_SSO_CLIENT_SECRET!.trim(),
      code: url.searchParams.get("code") || "",
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
      code_verifier: stored.verifier,
    }),
  });
  const tokens = (await tokenResponse.json().catch(() => ({}))) as {
    access_token?: string;
  };
  if (!tokenResponse.ok || !tokens.access_token)
    throw new ApiError(401, "oauth_failed", "淡江登入未完成。");
  if (!endpoints.userinfo_endpoint)
    throw new ApiError(503, "tamkang_unconfigured", "淡江 SSO 尚未完成設定");
  const profileResponse = await fetch(endpoints.userinfo_endpoint, {
    headers: { Authorization: "Bearer " + tokens.access_token },
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  const profile = (await profileResponse.json().catch(() => ({}))) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    preferred_username?: string;
  };
  if (!profileResponse.ok || !profile.sub)
    throw new ApiError(401, "oauth_failed", "淡江登入未完成。");
  const user = completeExternalLogin({
    provider: "tamkang",
    subject: profile.sub,
    email: profile.email || null,
    emailVerified: true,
    name: profile.name || profile.preferred_username || "淡江使用者",
    avatar: null,
    linkUserId: stored.linkUserId,
  });
  return { cookie: sessionCookie(issueSession(user.id)) };
}
