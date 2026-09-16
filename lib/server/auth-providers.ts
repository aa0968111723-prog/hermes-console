import { ApiError } from "./errors";
import {
  boundLinkActor,
  consumeOAuthState,
  createOAuthState,
  loginWithIdentity,
  pkcePair,
  tamkangConfigured,
} from "./identity";

function origin() {
  try {
    return new URL(process.env.CONSOLE_ORIGIN || "").origin;
  } catch {
    throw new ApiError(503, "setup_required", "後端尚未設定 CONSOLE_ORIGIN。");
  }
}

export function googleConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

export function startGoogleOAuth(mode: "login" | "link", userId?: string) {
  if (!googleConfigured())
    throw new ApiError(503, "oauth_unconfigured", "Google 登入尚未完成設定。");
  const { verifier, challenge } = pkcePair();
  const state = createOAuthState({
    provider: "google",
    mode,
    verifier,
    userId,
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!.trim());
  url.searchParams.set("redirect_uri", origin() + "/api/auth/google/callback");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function finishGoogleOAuth(url: URL, actorId?: string) {
  const error = url.searchParams.get("error");
  if (error)
    throw new ApiError(401, "oauth_denied", "Google 登入已取消或被拒絕。");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !state)
    throw new ApiError(400, "oauth_state", "Google 回呼缺少授權碼。");
  const record = consumeOAuthState(state, "google");
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
    redirect_uri: origin() + "/api/auth/google/callback",
    grant_type: "authorization_code",
    code_verifier: record.verifier || "",
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const tokens = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    id_token?: string;
  };
  if (!tokenRes.ok || !tokens.access_token)
    throw new ApiError(401, "oauth_failed", "Google 授權未完成。");
  const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: "Bearer " + tokens.access_token },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const profile = (await profileRes.json().catch(() => ({}))) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (!profile.sub)
    throw new ApiError(401, "oauth_failed", "Google 未回傳使用者識別。");
  const mode = record.mode === "link" ? "link" : "login";
  return loginWithIdentity({
    provider: "google",
    providerId: profile.sub,
    email: profile.email || null,
    emailVerified: !!profile.email_verified,
    name: profile.name || "Google 使用者",
    avatarUrl: profile.picture || null,
    mode,
    actorId: boundLinkActor(mode, record.userId, actorId),
  });
}

export type TamkangProtocol = "oidc" | "oauth" | "saml" | "cas";

export class TamkangAuthProvider {
  protocol: TamkangProtocol;
  configured: boolean;
  constructor() {
    const info = tamkangConfigured();
    this.protocol = (
      ["oidc", "oauth", "saml", "cas"].includes(info.protocol)
        ? info.protocol
        : "oidc"
    ) as TamkangProtocol;
    this.configured = info.configured;
  }
  start(mode: "login" | "link", userId?: string) {
    if (!this.configured)
      throw new ApiError(
        503,
        "tamkang_sso_unconfigured",
        "淡江 SSO 尚未完成設定",
      );
    if (this.protocol === "saml" || this.protocol === "cas")
      throw new ApiError(
        503,
        "tamkang_sso_unconfigured",
        "淡江 SSO 尚未完成設定",
      );
    const info = tamkangConfigured();
    const { verifier, challenge } = pkcePair();
    const state = createOAuthState({
      provider: "tamkang",
      mode,
      verifier,
      userId,
    });
    const authorize =
      (info.issuer ? info.issuer.replace(/\/$/, "") + "/authorize" : "") ||
      info.metadata;
    if (!authorize.startsWith("https://"))
      throw new ApiError(
        503,
        "tamkang_sso_unconfigured",
        "淡江 SSO 尚未完成設定",
      );
    const url = new URL(
      authorize.includes("/authorize")
        ? authorize
        : new URL("/authorize", info.issuer).toString(),
    );
    url.searchParams.set("client_id", info.clientId);
    url.searchParams.set("redirect_uri", origin() + "/api/auth/tamkang/callback");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }
}

export function startTamkangOAuth(mode: "login" | "link", userId?: string) {
  return new TamkangAuthProvider().start(mode, userId);
}

export async function finishTamkangOAuth(_url: URL, _actorId?: string): Promise<string> {
  const provider = new TamkangAuthProvider();
  if (!provider.configured)
    throw new ApiError(
      503,
      "tamkang_sso_unconfigured",
      "淡江 SSO 尚未完成設定",
    );
  throw new ApiError(
    503,
    "tamkang_sso_unconfigured",
    "淡江 SSO 尚未完成設定",
  );
}
