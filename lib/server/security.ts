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
