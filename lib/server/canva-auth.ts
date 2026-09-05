import crypto from "crypto";

export interface CanvaOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
}

export const CANVA_DEFAULT_CONFIG: CanvaOAuthConfig = {
  clientId: process.env.CANVA_CLIENT_ID || "",
  clientSecret: process.env.CANVA_CLIENT_SECRET || "",
  redirectUri: process.env.CANVA_REDIRECT_URI || "http://localhost:3000/api/auth/canva/callback",
  authUrl: "https://www.canva.com/api/oauth/authorize",
  tokenUrl: "https://api.canva.com/rest/v1/oauth/token",
  scopes: [
    "design:content:read",
    "design:content:write",
    "asset:read",
    "asset:write"
  ]
};

/**
 * 產生 PKCE Code Verifier 與 Code Challenge
 */
export function generatePkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

/**
 * 建立 Canva OAuth 授權連結與狀態資料
 */
export function buildCanvaAuthorizationUrl(redirectUriOverride?: string) {
  const { verifier, challenge } = generatePkcePair();
  const state = crypto.randomBytes(24).toString("hex");
  const redirectUri = redirectUriOverride || CANVA_DEFAULT_CONFIG.redirectUri;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CANVA_DEFAULT_CONFIG.clientId || "demo-client-id",
    redirect_uri: redirectUri,
    scope: CANVA_DEFAULT_CONFIG.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state
  });

  const authorizationUrl = `${CANVA_DEFAULT_CONFIG.authUrl}?${params.toString()}`;

  return {
    authorizationUrl,
    state,
    verifier,
    isDemo: !CANVA_DEFAULT_CONFIG.clientId
  };
}

/**
 * 伺服器端 Canva Token 結構
 */
export interface CanvaTokenInfo {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  obtainedAt: number;
  scope: string;
  isMock?: boolean;
}

// 記憶體中暫存工作區 Canva Token（無登入共享工作區模式）
let currentWorkspaceCanvaToken: CanvaTokenInfo | null = null;

export function setWorkspaceCanvaToken(token: CanvaTokenInfo) {
  currentWorkspaceCanvaToken = token;
}

export function getWorkspaceCanvaToken(): CanvaTokenInfo | null {
  if (!currentWorkspaceCanvaToken) return null;
  // 檢查是否已過期（預留 30 秒緩衝）
  const isExpired = Date.now() > currentWorkspaceCanvaToken.obtainedAt + (currentWorkspaceCanvaToken.expiresIn - 30) * 1000;
  if (isExpired) {
    return null;
  }
  return currentWorkspaceCanvaToken;
}
