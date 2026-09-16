import type { PublicProviderStatus } from "../../contracts";

function googleConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

function tamkangConfigured() {
  const protocol = (process.env.TAMKANG_SSO_PROTOCOL || "").trim();
  return !!(
    process.env.TAMKANG_SSO_ISSUER?.trim() &&
    process.env.TAMKANG_SSO_CLIENT_ID?.trim() &&
    process.env.TAMKANG_SSO_CLIENT_SECRET?.trim() &&
    (protocol === "oidc" || protocol === "oauth")
  );
}

function emailConfigured() {
  return !!(
    process.env.RESEND_API_KEY?.trim() &&
    process.env.CONSOLE_EMAIL_FROM?.trim() &&
    process.env.CONSOLE_ORIGIN?.trim()
  );
}

export function providerStatus(): PublicProviderStatus[] {
  return [
    {
      id: "google",
      configured: googleConfigured(),
      message: googleConfigured() ? null : "Google 登入尚未完成設定",
    },
    {
      id: "tamkang",
      configured: tamkangConfigured(),
      message: tamkangConfigured() ? null : "淡江 SSO 尚未完成設定",
    },
    {
      id: "email",
      configured: emailConfigured() || process.env.CONSOLE_ALLOW_LOCAL_ACCESS === "true",
      message: emailConfigured()
        ? null
        : process.env.CONSOLE_ALLOW_LOCAL_ACCESS === "true"
          ? "本機開發：未設定寄信時僅密碼登入可用"
          : "電子信箱驗證尚未完成寄信設定",
    },
  ];
}

export { googleConfigured, tamkangConfigured, emailConfigured };
