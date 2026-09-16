import { googleConfigured, emailConfigured } from "./auth/providers";
import { isAuthEnforced } from "./auth/session";

export function validateRuntimeEnv() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const origin = process.env.CONSOLE_ORIGIN?.trim();
  if (!origin) {
    throw new Error("缺少 CONSOLE_ORIGIN。請設定公開 origin 後再啟動。");
  }
  if (process.env.CONSOLE_ALLOW_LOCAL_ACCESS === "true") return;
  if (!isAuthEnforced()) return;
  if (!googleConfigured() && !emailConfigured()) {
    throw new Error(
      "正式環境需要 Google OAuth（GOOGLE_CLIENT_ID／SECRET）或 Email 寄信（RESEND_API_KEY／CONSOLE_EMAIL_FROM）。淡江 SSO 未設定時必須顯示尚未完成，不可假裝成功。",
    );
  }
}
