export type ErrorCategory =
  | "AUTH_ERROR"
  | "PERMISSION_ERROR"
  | "TOOL_UNAVAILABLE"
  | "TOOL_TIMEOUT"
  | "RATE_LIMIT"
  | "INVALID_INPUT"
  | "NETWORK_ERROR"
  | "UPSTREAM_ERROR"
  | "UNKNOWN";

const BY_CODE: Record<string, ErrorCategory> = {
  sign_in_required: "AUTH_ERROR",
  session_expired: "AUTH_ERROR",
  invalid_login: "AUTH_ERROR",
  invalid_link: "AUTH_ERROR",
  gateway_required: "AUTH_ERROR",
  gateway_unconfigured: "AUTH_ERROR",
  setup_required: "AUTH_ERROR",
  oauth_unconfigured: "AUTH_ERROR",
  oauth_failed: "AUTH_ERROR",
  tamkang_unconfigured: "AUTH_ERROR",
  email_unverified: "AUTH_ERROR",
  origin_rejected: "PERMISSION_ERROR",
  workspace_forbidden: "PERMISSION_ERROR",
  admin_required: "PERMISSION_ERROR",
  confirmation_required: "PERMISSION_ERROR",
  confirmation_invalid: "PERMISSION_ERROR",
  confirmation_mismatch: "PERMISSION_ERROR",
  identity_conflict: "PERMISSION_ERROR",
  ssrf_rejected: "PERMISSION_ERROR",
  mcp_target_not_allowed: "PERMISSION_ERROR",
  rate_limited: "RATE_LIMIT",
  invalid_input: "INVALID_INPUT",
  invalid_json: "INVALID_INPUT",
  invalid_body: "INVALID_INPUT",
  invalid_url: "INVALID_INPUT",
  content_type: "INVALID_INPUT",
  too_large: "INVALID_INPUT",
  hermes_unconfigured: "TOOL_UNAVAILABLE",
  mcp_credential_missing: "TOOL_UNAVAILABLE",
  tool_unavailable: "TOOL_UNAVAILABLE",
  tool_timeout: "TOOL_TIMEOUT",
  upstream_401: "UPSTREAM_ERROR",
  upstream_403: "UPSTREAM_ERROR",
  upstream_404: "UPSTREAM_ERROR",
  upstream_429: "RATE_LIMIT",
  email_failed: "UPSTREAM_ERROR",
  store_unavailable: "NETWORK_ERROR",
};

export function errorCategory(code: string): ErrorCategory {
  return BY_CODE[code] || "UNKNOWN";
}
