const PRODUCTION_REQUIRED = ["CONSOLE_ORIGIN"] as const;

export function validateRuntimeEnv() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const missing = PRODUCTION_REQUIRED.filter(
    (name) => !String(process.env[name] || "").trim(),
  );
  if (missing.length) {
    throw new Error(
      "正式環境缺少必要設定：" + missing.join(", ") + "。請在部署端補齊後再啟動。",
    );
  }
}

export function authProviderFlags() {
  return {
    google: !!(
      process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim()
    ),
    tamkang: tamkangConfigured(),
    email: true,
  };
}

export function tamkangConfigured() {
  const protocol = (process.env.TAMKANG_SSO_PROTOCOL || "oidc").toLowerCase();
  if (protocol === "saml" || protocol === "cas") return false;
  const clientId = process.env.TAMKANG_SSO_CLIENT_ID?.trim();
  const secret = process.env.TAMKANG_SSO_CLIENT_SECRET?.trim();
  const issuer = process.env.TAMKANG_SSO_ISSUER?.trim();
  const metadata = process.env.TAMKANG_SSO_METADATA_URL?.trim();
  const authorize = process.env.TAMKANG_SSO_AUTHORIZE_URL?.trim();
  const token = process.env.TAMKANG_SSO_TOKEN_URL?.trim();
  return !!(
    clientId &&
    secret &&
    (issuer || metadata || (authorize && token))
  );
}

export function localAuthConvenience() {
  if (process.env.CONSOLE_ALLOW_LOCAL_ACCESS !== "true") return false;
  try {
    const origin = new URL(process.env.CONSOLE_ORIGIN || "");
    return (
      origin.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
    );
  } catch {
    return false;
  }
}
