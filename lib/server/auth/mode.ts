export type AuthMode = "required" | "workspace";

export function authMode(): AuthMode {
  const mode = process.env.CONSOLE_AUTH_MODE?.trim();
  if (mode === "workspace") return "workspace";
  if (mode === "required") return "required";
  return process.env.NODE_ENV === "production" ? "required" : "workspace";
}

export function isAuthRequired() {
  return authMode() === "required";
}

export function googleConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

export type TamkangProtocol = "oidc" | "oauth" | "saml" | "cas";

export function tamkangProtocol(): TamkangProtocol | null {
  const value = process.env.TAMKANG_SSO_PROTOCOL?.trim().toLowerCase();
  if (value === "oidc" || value === "oauth" || value === "saml" || value === "cas")
    return value;
  if (process.env.TAMKANG_OIDC_ISSUER?.trim()) return "oidc";
  return null;
}

export function tamkangConfigured() {
  const protocol = tamkangProtocol();
  if (!protocol) return false;
  if (protocol === "oidc" || protocol === "oauth") {
    return !!(
      process.env.TAMKANG_CLIENT_ID?.trim() &&
      (process.env.TAMKANG_OIDC_ISSUER?.trim() ||
        process.env.TAMKANG_SSO_METADATA_URL?.trim())
    );
  }
  return !!(
    process.env.TAMKANG_SSO_METADATA_URL?.trim() &&
    process.env.TAMKANG_CLIENT_ID?.trim()
  );
}

export function mailConfigured() {
  return !!(
    process.env.RESEND_API_KEY?.trim() && process.env.CONSOLE_EMAIL_FROM?.trim()
  );
}

export function authPublicState() {
  return {
    mode: authMode(),
    required: isAuthRequired(),
    google: googleConfigured() ? ("available" as const) : ("unconfigured" as const),
    tamkang: tamkangConfigured()
      ? ("available" as const)
      : ("unconfigured" as const),
    tamkangProtocol: tamkangProtocol(),
    email: "available" as const,
    magicLink: mailConfigured() ? ("available" as const) : ("unconfigured" as const),
  };
}
