import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { get, put, transaction } from "./store";
import { ApiError, hash } from "./security";
import { readJSON } from "./hermes";
import { seal, unseal } from "./vault";

const API = "https://api.canva.com/rest/v1";
const scopes =
  "design:meta:read design:content:read design:content:write asset:read asset:write brandtemplate:meta:read brandtemplate:content:read";
type Tokens = {
  access_token: string;
  refresh_token: string;
  expiresAt: number;
  scope: string;
};
type StoredTokens = { id: string; ciphertext: string };
export function canvaConfigured() {
  return !!(
    process.env.CANVA_CLIENT_ID &&
    process.env.CANVA_CLIENT_SECRET &&
    process.env.CONSOLE_VAULT_KEY
  );
}
function redirectURI() {
  return new URL("/api/canva/callback", process.env.CONSOLE_ORIGIN).toString();
}
export function startCanvaAuth(owner: string, sessionDigest: string) {
  if (!canvaConfigured())
    throw new ApiError(
      503,
      "canva_unconfigured",
      "請設定 Canva Client ID、Client Secret 與秘密儲存金鑰。",
    );
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(48).toString("base64url");
  put("oauth", owner, {
    id: hash(state),
    ciphertext: seal({ verifier, sessionDigest }),
    expires: Date.now() + 600_000,
    used: false,
  });
  const url = new URL("https://www.canva.com/api/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: process.env.CANVA_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectURI(),
    scope: scopes,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
  }).toString();
  return { url: url.toString(), state };
}
async function exchange(owner: string, body: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(API + "/oauth/token", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            process.env.CANVA_CLIENT_ID + ":" + process.env.CANVA_CLIENT_SECRET,
          ).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    });
  } catch {
    throw new ApiError(
      502,
      "canva_oauth_network",
      "Canva 授權交換中斷，請重新授權。",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(
      502,
      "canva_oauth_failed",
      "Canva 未接受授權交換，請核對重新導向網址與權限。",
    );
  }
  const parsed = z
    .object({
      access_token: z.string(),
      refresh_token: z.string(),
      expires_in: z.number(),
      scope: z.string().optional(),
    })
    .parse(await readJSON(response));
  const tokens: Tokens = {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
    expiresAt: Date.now() + parsed.expires_in * 1000,
    scope: parsed.scope || scopes,
  };
  put("canva_tokens", owner, { id: "current", ciphertext: seal(tokens) });
  return tokens;
}
export async function completeCanvaAuth(
  owner: string,
  state: string,
  code: string,
  sessionValid: (digest: string) => boolean,
) {
  const pending = transaction(() => {
    const record = get<{
      id: string;
      ciphertext: string;
      expires: number;
      used: boolean;
    }>("oauth", owner, hash(state));
    if (!record || record.used || record.expires < Date.now())
      throw new ApiError(
        403,
        "invalid_oauth_state",
        "授權狀態無效或已過期，請重新開始。",
      );
    const value = unseal<{ verifier: string; sessionDigest: string }>(
      record.ciphertext,
    );
    if (!sessionValid(value.sessionDigest))
      throw new ApiError(
        401,
        "expired_session",
        "原工作區登入已失效，請重新登入後授權。",
      );
    put("oauth", owner, { ...record, used: true });
    return value;
  });
  await exchange(owner, {
    grant_type: "authorization_code",
    code,
    code_verifier: pending.verifier,
    redirect_uri: redirectURI(),
  });
  return verifyCanva(owner);
}
const runtimeTokens = globalThis as typeof globalThis & {
  hermesCanvaRefreshes?: Map<string, Promise<Tokens>>;
};
const refreshes = (runtimeTokens.hermesCanvaRefreshes ??= new Map<
  string,
  Promise<Tokens>
>());
async function token(owner: string) {
  const stored = get<StoredTokens>("canva_tokens", owner, "current");
  if (!stored)
    throw new ApiError(
      409,
      "canva_authorization_required",
      "請先從設定完成 Canva 使用者授權。",
    );
  const tokens = unseal<Tokens>(stored.ciphertext);
  if (tokens.expiresAt > Date.now() + 60_000) return tokens.access_token;
  let pending = refreshes.get(owner);
  if (!pending) {
    pending = exchange(owner, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    refreshes.set(owner, pending);
  }
  try {
    return (await pending).access_token;
  } finally {
    refreshes.delete(owner);
  }
}
export async function canvaRequest(
  owner: string,
  path: string,
  init: RequestInit = {},
) {
  if (
    !/^\/(designs(?:\/[a-zA-Z0-9_-]+)?(?:\?query=[^#]*)?|asset-uploads(?:\/[a-zA-Z0-9_-]+)?|exports(?:\/[a-zA-Z0-9_-]+)?|autofills(?:\/[a-zA-Z0-9_-]+)?|brand-templates\/[a-zA-Z0-9_-]+\/dataset)$/.test(
      path,
    )
  )
    throw new ApiError(400, "canva_path_rejected", "不允許此 Canva 操作。");
  const access = await token(owner);
  let response: Response;
  try {
    response = await fetch(API + path, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
        Authorization: "Bearer " + access,
      },
    });
  } catch {
    throw new ApiError(
      502,
      "canva_uncertain",
      "Canva 請求中斷；有副作用的操作不能自動重送，請先確認結果。",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    const detail = [401, 403].includes(response.status)
      ? "Canva 授權無效或權限不足，請重新授權。"
      : response.status === 429
        ? "Canva 請求額度受限，請稍後再試。"
        : "Canva 操作失敗，請檢查範本與授權範圍。";
    put("canva_status", owner, {
      id: "current",
      state: [401, 403].includes(response.status)
        ? "awaiting_authorization"
        : "failed",
      checkedAt: new Date().toISOString(),
      message: detail,
    });
    throw new ApiError(502, "canva_" + response.status, detail);
  }
  return readJSON(response);
}
export async function verifyCanva(owner: string) {
  const result = await canvaRequest(owner, "/designs");
  if (!Array.isArray(result.items))
    throw new ApiError(
      502,
      "invalid_canva_response",
      "Canva 未回傳有效設計清單。",
    );
  const status = {
    id: "current",
    state: "partial",
    checkedAt: new Date().toISOString(),
    message: "已驗證設計清單讀取。建立、上傳與匯出仍需個別執行驗證。",
  };
  put("canva_status", owner, status);
  return status;
}
export function canvaStatus(owner: string) {
  const status = get<{ state: string; checkedAt: string; message: string }>(
    "canva_status",
    owner,
    "current",
  );
  return {
    configured: canvaConfigured(),
    state:
      status?.state ||
      (canvaConfigured() ? "awaiting_authorization" : "unconfigured"),
    verifiedAt: status?.checkedAt || null,
    message: status?.message || "尚未完成 Canva Connect 使用者授權。",
  };
}
