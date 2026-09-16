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
  google_unconfigured: "AUTH_ERROR",
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
  concurrency_limit: "RATE_LIMIT",
  invalid_input: "INVALID_INPUT",
  invalid_json: "INVALID_INPUT",
  invalid_body: "INVALID_INPUT",
  invalid_url: "INVALID_INPUT",
  content_type: "INVALID_INPUT",
  too_large: "INVALID_INPUT",
  github_is_not_mcp: "INVALID_INPUT",
  hermes_unconfigured: "TOOL_UNAVAILABLE",
  hermes_not_ready: "TOOL_UNAVAILABLE",
  mcp_credential_missing: "TOOL_UNAVAILABLE",
  tool_unavailable: "TOOL_UNAVAILABLE",
  tool_timeout: "TOOL_TIMEOUT",
  idle_timeout: "TOOL_TIMEOUT",
  upstream_401: "UPSTREAM_ERROR",
  upstream_403: "UPSTREAM_ERROR",
  upstream_404: "UPSTREAM_ERROR",
  upstream_429: "RATE_LIMIT",
  email_failed: "UPSTREAM_ERROR",
  empty_output: "UPSTREAM_ERROR",
  empty_stream: "UPSTREAM_ERROR",
  store_unavailable: "NETWORK_ERROR",
  internal_error: "UNKNOWN",
};

export function errorCategory(code: string): ErrorCategory {
  if (BY_CODE[code]) return BY_CODE[code];
  if (
    /^(google_|tamkang_|oauth_|gateway_|sign_in|session_|invalid_login|invalid_link|email_unverified)/.test(
      code,
    )
  )
    return "AUTH_ERROR";
  if (
    /(_forbidden|admin_|confirmation_|identity_conflict|ssrf|mcp_target|scope_mismatch|tool_scope|origin_rejected|private_content|activity_scope|memory_scope|learning_scope)/.test(
      code,
    )
  )
    return "PERMISSION_ERROR";
  if (/timeout/.test(code)) return "TOOL_TIMEOUT";
  if (/rate_limited|concurrency_limit|upstream_429/.test(code))
    return "RATE_LIMIT";
  if (
    /unconfigured|_token_missing|not_ready|unknown_tool|tool_unavailable|tool_failed|mcp_credential/.test(
      code,
    )
  )
    return "TOOL_UNAVAILABLE";
  if (/store_unavailable|zeabur_network|network_error/.test(code))
    return "NETWORK_ERROR";
  if (
    /_empty$|empty_|_failed$|upstream_|invalid_stream|invalid_response|probe_failed|zeabur_invalid|galley_invalid/.test(
      code,
    )
  )
    return "UPSTREAM_ERROR";
  if (
    /invalid_|too_large|content_type|empty_file|not_found|_conflict|sensitive_content|upload_limit|url_required/.test(
      code,
    )
  )
    return "INVALID_INPUT";
  return "UNKNOWN";
}
