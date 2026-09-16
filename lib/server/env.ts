import { googleConfigured, emailConfigured } from "./auth/providers";
import { isAuthEnforced } from "./auth/session";

function isLoopbackHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

export function validateRuntimeEnv() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NODE_ENV === "production") {
    if (process.env.NODE_TEST_CONTEXT || process.env.CONSOLE_TEST_SESSION) {
      throw new Error("測試用 session 不得用於正式環境。");
    }
  }
  const origin = process.env.CONSOLE_ORIGIN?.trim() || "";
  const allowLocal = process.env.CONSOLE_ALLOW_LOCAL_ACCESS === "true";
  if (!origin) {
    throw new Error(
      process.env.NODE_ENV === "production" && !allowLocal
        ? "缺少 CONSOLE_ORIGIN。正式環境必須設定公開 HTTPS origin。"
        : "缺少 CONSOLE_ORIGIN。請設定公開 origin 後再啟動。",
    );
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("CONSOLE_ORIGIN 不是有效網址。");
  }
  const loopback = isLoopbackHostname(url.hostname);
  if (process.env.NODE_ENV === "production") {
    if (allowLocal && !loopback) {
      throw new Error("CONSOLE_ALLOW_LOCAL_ACCESS 只能用於本機 loopback。");
    }
    if (!loopback && url.protocol !== "https:") {
      throw new Error("正式環境的 CONSOLE_ORIGIN 必須是 HTTPS。");
    }
  }
  if (allowLocal) return;
  if (!isAuthEnforced()) return;
  if (!googleConfigured() && !emailConfigured()) {
    throw new Error(
      "正式環境需要 Google OAuth（GOOGLE_CLIENT_ID／SECRET）或 Email 寄信（RESEND_API_KEY／CONSOLE_EMAIL_FROM）。淡江 SSO 未設定時必須顯示尚未完成，不可假裝成功。",
    );
  }
}
