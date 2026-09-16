import { createHash, randomBytes } from "node:crypto";
import { ApiError, assertSafeServiceUrl, limited } from "../../security";
import { tamkangConfigured, tamkangProtocol } from "../mode";
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

type Discovery = {
  authorization: string;
  token: string;
  userinfo: string | null;
  issuer: string;
};

let cached: { key: string; at: number; value: Discovery } | null = null;

function origin() {
  try {
    return new URL(process.env.CONSOLE_ORIGIN || "").origin;
  } catch {
    throw new ApiError(503, "setup_required", "後端尚未設定 CONSOLE_ORIGIN。");
  }
}

function redirectUri() {
  return origin() + "/api/auth/tamkang/callback";
}

function challenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function issuerValue() {
  return (process.env.TAMKANG_OIDC_ISSUER || "").trim().replace(/\/$/, "");
}

function endpointUrl(value: string, kind: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(
      503,
      "AUTH_ERROR",
      "淡江 SSO 尚未完成設定",
      "AUTH_ERROR",
    );
  }
  if (url.search || url.hash || url.username || url.password)
    throw new ApiError(
      503,
      "AUTH_ERROR",
      "淡江 Identity Provider 端點不安全。",
      "AUTH_ERROR",
    );
  try {
    assertSafeServiceUrl(
      url.origin + (url.pathname === "/" ? "" : url.pathname),
    );
  } catch {
    throw new ApiError(
      503,
      "AUTH_ERROR",
      "淡江 Identity Provider 端點不安全。",
      "AUTH_ERROR",
    );
  }
  if (!url.pathname || url.pathname === "/")
    throw new ApiError(
      503,
      "AUTH_ERROR",
      "淡江 " + kind + " 端點無效。",
      "AUTH_ERROR",
    );
  return url.toString();
}

async function discover(): Promise<Discovery> {
  const issuer = issuerValue();
  if (!issuer)
    throw new ApiError(
      503,
      "AUTH_ERROR",
      "淡江 SSO 尚未完成設定",
      "AUTH_ERROR",
    );
  if (cached && cached.key === issuer && Date.now() - cached.at < 10 * 60_000)
    return cached.value;
  let issuerUrl: URL;
  try {
    issuerUrl = assertSafeServiceUrl(issuer);
  } catch {
    throw new ApiError(
      503,
      "AUTH_ERROR",
      "淡江 Identity Provider 位址不安全。",
      "AUTH_ERROR",
    );
  }
  const wellKnown =
    issuerUrl.toString().replace(/\/$/, "") + "/.well-known/openid-configuration";
  const response = await fetch(wellKnown, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => null)) as {
    issuer?: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
    userinfo_endpoint?: string;
  } | null;
  if (
    !response.ok ||
    !body ||
    typeof body.authorization_endpoint !== "string" ||
    typeof body.token_endpoint !== "string"
  )
    throw new ApiError(
      503,
      "AUTH_ERROR",
      "無法讀取淡江正式 Identity Provider 設定。",
      "AUTH_ERROR",
    );
  const discoveredIssuer = (body.issuer || issuer).replace(/\/$/, "");
  if (discoveredIssuer !== issuer)
    throw new ApiError(
      401,
      "AUTH_ERROR",
      "淡江身分無法驗證。",
      "AUTH_ERROR",
    );
  const value: Discovery = {
    issuer,
    authorization: endpointUrl(body.authorization_endpoint, "authorization"),
    token: endpointUrl(body.token_endpoint, "token"),
    userinfo: body.userinfo_endpoint
      ? endpointUrl(body.userinfo_endpoint, "userinfo")
      : null,
  };
  cached = { key: issuer, at: Date.now(), value };
  return value;
}

function jwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3)
    throw new ApiError(401, "AUTH_ERROR", "淡江身分無法驗證。", "AUTH_ERROR");
  try {
    return JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    throw new ApiError(401, "AUTH_ERROR", "淡江身分無法驗證。", "AUTH_ERROR");
  }
}

function audienceMatches(aud: unknown, clientId: string) {
  if (aud === clientId) return true;
  return Array.isArray(aud) && aud.includes(clientId);
}

async function startTamkangOidc(userId?: string) {
  limited("oauth:tamkang:start", 30, 15 * 60_000);
  const discovery = await discover();
  const state = randomBytes(24).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  putAuthToken(state, {
    userId: userId || "",
    purpose: "oauth_state",
    expiresAt: Date.now() + 10 * 60_000,
    used: false,
    payload: { nonce, verifier, provider: "tamkang" },
  });
  const url = new URL(discovery.authorization);
  url.searchParams.set("client_id", process.env.TAMKANG_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function handleTamkangCallback(url: URL, userId?: string) {
  limited("oauth:tamkang:callback", 30, 15 * 60_000);
  const discovery = await discover();
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !/^[a-f0-9]{48}$/.test(state))
    throw new ApiError(401, "AUTH_ERROR", "淡江回呼無效。", "AUTH_ERROR");
  const record = consumeAuthToken(state);
  if (record.purpose !== "oauth_state" || record.payload?.provider !== "tamkang")
    throw new ApiError(401, "AUTH_ERROR", "淡江回呼已失效。", "AUTH_ERROR");
  const verifier = record.payload?.verifier || "";
  const body = new URLSearchParams({
    code,
    client_id: process.env.TAMKANG_CLIENT_ID!,
    client_secret: process.env.TAMKANG_CLIENT_SECRET!,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  const tokenResponse = await fetch(discovery.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const tokens = (await tokenResponse.json().catch(() => ({}))) as {
    id_token?: string;
    access_token?: string;
  };
  if (!tokenResponse.ok)
    throw new ApiError(401, "AUTH_ERROR", "淡江授權未完成。", "AUTH_ERROR");
  let profile: {
    sub?: string;
    email?: string;
    email_verified?: string | boolean;
    name?: string;
    picture?: string;
    iss?: string;
    aud?: unknown;
    nonce?: string;
    exp?: number;
  } = {};
  if (typeof tokens.id_token === "string") {
    profile = jwtPayload(tokens.id_token);
    if (
      (profile.iss || "").replace(/\/$/, "") !== discovery.issuer ||
      !audienceMatches(profile.aud, process.env.TAMKANG_CLIENT_ID!) ||
      profile.nonce !== record.payload?.nonce ||
      typeof profile.exp !== "number" ||
      profile.exp * 1000 < Date.now() - 30_000 ||
      typeof profile.sub !== "string" ||
      !profile.sub.trim()
    )
      throw new ApiError(401, "AUTH_ERROR", "淡江身分無法驗證。", "AUTH_ERROR");
  } else if (tokens.access_token && discovery.userinfo) {
    const infoResponse = await fetch(discovery.userinfo, {
      headers: { Authorization: "Bearer " + tokens.access_token },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    profile = (await infoResponse.json().catch(() => ({}))) as typeof profile;
    if (!infoResponse.ok || typeof profile.sub !== "string" || !profile.sub.trim())
      throw new ApiError(401, "AUTH_ERROR", "淡江身分無法驗證。", "AUTH_ERROR");
  } else {
    throw new ApiError(401, "AUTH_ERROR", "淡江授權未完成。", "AUTH_ERROR");
  }
  const existing = findIdentity("tamkang", profile.sub!);
  const actor = userId || record.userId;
  let user = actor ? getUser(actor) : existing ? getUser(existing.userId) : null;
  if (actor && existing && existing.userId !== actor)
    throw new ApiError(
      409,
      "identity_taken",
      "此淡江帳號已連結其他使用者。",
      "AUTH_ERROR",
    );
  if (!user) {
    user = createUser({
      email: typeof profile.email === "string" ? profile.email : null,
      emailVerified:
        profile.email_verified === true || profile.email_verified === "true",
      name:
        typeof profile.name === "string" && profile.name.trim()
          ? profile.name
          : "淡江使用者",
      avatar: typeof profile.picture === "string" ? profile.picture : null,
    });
  } else if (!user.avatar && typeof profile.picture === "string") {
    saveUser({
      ...user,
      avatar: profile.picture,
      name: user.name || (typeof profile.name === "string" ? profile.name : user.name),
    });
  }
  linkIdentity(user.id, {
    provider: "tamkang",
    subject: profile.sub!,
    email: typeof profile.email === "string" ? profile.email : null,
    emailVerified:
      profile.email_verified === true || profile.email_verified === "true",
    name: typeof profile.name === "string" ? profile.name : null,
    avatar: typeof profile.picture === "string" ? profile.picture : null,
  });
  return issueSession(user.id);
}

export const TamkangAuthProvider = {
  protocol: tamkangProtocol,
  isConfigured: tamkangConfigured,
  unavailableMessage() {
    return "淡江 SSO 尚未完成設定";
  },
  async start(userId?: string) {
    if (!this.isConfigured())
      throw new ApiError(
        503,
        "AUTH_ERROR",
        this.unavailableMessage(),
        "AUTH_ERROR",
      );
    const protocol = this.protocol();
    if (protocol !== "oidc" && protocol !== "oauth")
      throw new ApiError(
        503,
        "AUTH_ERROR",
        this.unavailableMessage(),
        "AUTH_ERROR",
      );
    return startTamkangOidc(userId);
  },
  async callback(url: URL, userId?: string) {
    if (!this.isConfigured())
      throw new ApiError(
        503,
        "AUTH_ERROR",
        this.unavailableMessage(),
        "AUTH_ERROR",
      );
    const protocol = this.protocol();
    if (protocol !== "oidc" && protocol !== "oauth")
      throw new ApiError(
        503,
        "AUTH_ERROR",
        this.unavailableMessage(),
        "AUTH_ERROR",
      );
    return handleTamkangCallback(url, userId);
  },
};
