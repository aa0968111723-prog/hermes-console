const PRODUCTION_REQUIRED = ["CONSOLE_ORIGIN"] as const;

function isLoopbackHost(hostname: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

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
  let origin: URL;
  try {
    origin = new URL(process.env.CONSOLE_ORIGIN || "");
  } catch {
    throw new Error("CONSOLE_ORIGIN 不是有效的公開 origin。");
  }
  if (origin.username || origin.password)
    throw new Error("CONSOLE_ORIGIN 不可包含帳號或密碼。");
  const loopback = isLoopbackHost(origin.hostname);
  if (!loopback && origin.protocol !== "https:")
    throw new Error("正式環境的 CONSOLE_ORIGIN 必須是 HTTPS。");
  if (process.env.CONSOLE_ALLOW_LOCAL_ACCESS === "true" && !loopback)
    throw new Error(
      "CONSOLE_ALLOW_LOCAL_ACCESS 只能用在 loopback，正式公開網域必須關閉。",
    );
  if (process.env.CONSOLE_REQUIRE_GATEWAY === "true") {
    const secret = String(process.env.CONSOLE_GATEWAY_SECRET || "").trim();
    if (secret.length < 32)
      throw new Error(
        "CONSOLE_REQUIRE_GATEWAY=true 時 CONSOLE_GATEWAY_SECRET 至少 32 字元。",
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
