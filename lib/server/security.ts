import type { NextRequest } from "next/server";
import crypto from "crypto";

/**
 * 簡易記憶體滑動視窗速率限制
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// 定期清除過期紀錄
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap.entries()) {
      if (entry.resetAt <= now) {
        rateLimitMap.delete(key);
      }
    }
  }, 60000).unref?.();
}

/**
 * 速率限制檢查器
 */
export function checkRateLimit(
  key: string,
  maxRequests: number = 60,
  windowMs: number = 60000
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

/**
 * 同源寫入保護檢驗 (Same-Origin Check)
 * 防禦跨站偽造請求 (CSRF) 針對 POST/PUT/DELETE
 */
export function verifySameOrigin(req: NextRequest): { ok: boolean; reason?: string } {
  // GET / HEAD / OPTIONS 不檢驗同源寫入
  const method = req.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return { ok: true };
  }

  const originHeader = req.headers.get("origin");
  const refererHeader = req.headers.get("referer");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");

  if (!originHeader && !refererHeader) {
    // 允許內部同主機 API 測試或伺服器端調用，但在瀏覽器環境若皆無則視為異常
    return { ok: true };
  }

  const checkUrl = originHeader || refererHeader;
  if (!checkUrl) return { ok: true };

  try {
    const parsed = new URL(checkUrl);
    // 比對 host (忽略 port 或大小寫)
    if (host && parsed.host.toLowerCase() === host.toLowerCase()) {
      return { ok: true };
    }
    // 本地開發模式寬容 (localhost:3000, 127.0.0.1)
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return { ok: true };
    }
    return { ok: false, reason: `跨來源請求已被拒絕: 來源 ${parsed.host} 與目標 ${host} 不符` };
  } catch {
    return { ok: false, reason: "無法解析請求來源標頭" };
  }
}

/**
 * 產生安全 CSRF Token
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

/**
 * SSRF 防護檢驗
 * 防止惡意使用者誘使伺服器向私有 IP、雲端 Metadata (如 169.254.169.254) 發送內部連線
 */
export function validateSsrfSafeUrl(urlStr: string, allowLocal: boolean = false): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(urlStr);
    const protocol = parsed.protocol.toLowerCase();

    if (protocol !== "http:" && protocol !== "https:") {
      return { safe: false, reason: "僅支援 HTTP 或 HTTPS 協議" };
    }

    const host = parsed.hostname.toLowerCase();

    // 檢查雲端 Metadata 服務與 Link-Local
    if (host === "169.254.169.254" || host.startsWith("169.254.")) {
      return { safe: false, reason: "禁止連線至雲端 Metadata 服務" };
    }

    // 檢查 localhost 與私有 IP
    const isLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host);

    if (isLocal && !allowLocal && process.env.NODE_ENV === "production") {
      return { safe: false, reason: "生產環境禁止連線至內部私有網路" };
    }

    return { safe: true };
  } catch {
    return { safe: false, reason: "無效的 URL 格式" };
  }
}

import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { db, get, put, transaction } from "./store";

export const WORKSPACE_OWNER = "workspace";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function redact(text: string) {
  let output = text;
  for (const [name, value] of Object.entries(process.env)) {
    if (/(KEY|TOKEN|PASSWORD|SECRET)/i.test(name) && value && value.length >= 6)
      output = output.split(value).join("[redacted]");
  }
  return output
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, "[redacted]");
}
export function limited(key: string, maximum: number, windowMs: number) {
  const now = Date.now();
  db().prepare("DELETE FROM limits WHERE expires < ?").run(now);
  db()
    .prepare(
      "INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
    )
    .run(key, now + windowMs);
  const row = db().prepare("SELECT count FROM limits WHERE key=?").get(key)!;
  if (Number(row.count) > maximum)
    throw new ApiError(429, "rate_limited", "請稍後再試，請求次數已達限制。");
}
export function checkOrigin(request: Request) {
  const configured = process.env.CONSOLE_ORIGIN;
  if (!configured)
    throw new ApiError(503, "setup_required", "後端尚未設定 CONSOLE_ORIGIN。");
  if (request.headers.get("origin") !== new URL(configured).origin)
    throw new ApiError(
      403,
      "origin_rejected",
      "來源驗證失敗，請重新載入工作區。",
    );
}
export function authenticate(request: Request, mutation = false): string {
  if (mutation) checkOrigin(request);
  limited("api:" + WORKSPACE_OWNER, 240, 60_000);
  return WORKSPACE_OWNER;
}

export type ConfirmationRecord = {
  id: string;
  action: string;
  target: string;
  payloadHash: string;
  expiresAt: number;
  used: boolean;
};

export function payloadDigest(payload: unknown) {
  return hash(JSON.stringify(payload ?? null));
}

export function mintConfirmation(input: {
  action: string;
  target: string;
  payload: unknown;
  ttlMs?: number;
}) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + Math.min(input.ttlMs || 5 * 60_000, 15 * 60_000);
  put("confirmation", WORKSPACE_OWNER, {
    id: hash(token),
    action: input.action,
    target: input.target,
    payloadHash: payloadDigest(input.payload),
    expiresAt,
    used: false,
  } satisfies ConfirmationRecord);
  return { token, expiresAt, action: input.action, target: input.target };
}

export function consumeConfirmation(input: {
  token: unknown;
  action: string;
  target: string;
  payload: unknown;
}) {
  if (input.token === true || input.token === "true")
    throw new ApiError(
      403,
      "confirmation_required",
      "前端 confirmed=true 不足；此操作需要伺服器核發的一次性確認。",
    );
  const token = typeof input.token === "string" ? input.token : "";
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new ApiError(
      403,
      "confirmation_required",
      "此操作需要伺服器核發的一次性確認。",
    );
  transaction(() => {
    const record = get<ConfirmationRecord>(
      "confirmation",
      WORKSPACE_OWNER,
      hash(token),
    );
    if (!record || record.used || record.expiresAt < Date.now())
      throw new ApiError(
        403,
        "confirmation_invalid",
        "確認已失效、已使用或不存在，請重新確認。",
      );
    if (
      record.action !== input.action ||
      record.target !== input.target ||
      record.payloadHash !== payloadDigest(input.payload)
    )
      throw new ApiError(
        403,
        "confirmation_mismatch",
        "確認內容與操作不符，請重新確認。",
      );
    put("confirmation", WORKSPACE_OWNER, { ...record, used: true });
  });
}
export function verifyPassword(password: string, encoded: string) {
  const [scheme, salt, value] = encoded.split(":");
  if (
    scheme !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt || "") ||
    !/^[a-f0-9]{128}$/.test(value || "")
  )
    return false;
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(value, "hex"),
  );
}
export function login(username: string, password: string) {
  limited("login:global", 20, 15 * 60_000);
  const expected = process.env.CONSOLE_PASSWORD_HASH;
  if (!expected || !process.env.CONSOLE_USERNAME)
    throw new ApiError(
      503,
      "setup_required",
      "請在後端設定工作區帳號與新的密碼雜湊。",
    );
  const verified = verifyPassword(password, expected);
  if (username !== process.env.CONSOLE_USERNAME || !verified)
    throw new ApiError(401, "invalid_login", "帳號或密碼不正確。");
  const token = randomBytes(32).toString("hex");
  db().prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  db()
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(hash(token), "owner", Date.now() + 12 * 60 * 60_000);
  return token;
}
export function sessionCookie(token: string, logout = false) {
  const secure = process.env.CONSOLE_ORIGIN?.startsWith("https://")
    ? "; Secure"
    : "";
  return `hermes_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${logout ? 0 : 43200}${secure}`;
}
export async function jsonBody(
  request: Request,
  maxBytes = 64_000,
): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "content_type", "需要 JSON 請求。");
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new ApiError(413, "too_large", "請求內容過大。");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_body", "缺少請求內容。");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, "too_large", "請求內容過大。");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_json", "JSON 格式錯誤。");
  }
}
export function respond(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
export function route(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (error) {
      if (error instanceof ApiError)
        return respond(
          { error: { code: error.code, message: error.message } },
          error.status,
          error.status === 429 ? { "Retry-After": "60" } : {},
        );
      if (error instanceof z.ZodError)
        return respond(
          {
            error: {
              code: "invalid_input",
              message: "輸入格式不正確，請確認欄位與長度。",
            },
          },
          400,
        );
      return respond(
        {
          error: {
            code: "internal_error",
            message: "操作未完成，請查看設定或重試。",
          },
        },
        500,
      );
    }
  };
}
