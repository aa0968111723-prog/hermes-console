export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const ERROR_CATEGORY = {
  AUTH_ERROR: "AUTH_ERROR",
  PERMISSION_ERROR: "PERMISSION_ERROR",
  TOOL_UNAVAILABLE: "TOOL_UNAVAILABLE",
  TOOL_TIMEOUT: "TOOL_TIMEOUT",
  RATE_LIMIT: "RATE_LIMIT",
  INVALID_INPUT: "INVALID_INPUT",
  NETWORK_ERROR: "NETWORK_ERROR",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  UNKNOWN: "UNKNOWN",
} as const;

export type ErrorCategory =
  (typeof ERROR_CATEGORY)[keyof typeof ERROR_CATEGORY];

const AUTH = new Set([
  "AUTH_ERROR",
  "invalid_login",
  "sign_in_required",
  "session_expired",
  "gateway_required",
  "gateway_unconfigured",
  "email_unverified",
  "auth_unconfigured",
  "identity_conflict",
]);
const PERMISSION = new Set([
  "PERMISSION_ERROR",
  "origin_rejected",
  "admin_required",
  "membership_required",
  "confirmation_required",
  "confirmation_invalid",
  "confirmation_mismatch",
  "ssrf_rejected",
]);
const TIMEOUT = new Set(["TOOL_TIMEOUT", "tool_timeout", "connect_timeout"]);
const UNAVAILABLE = new Set([
  "TOOL_UNAVAILABLE",
  "tool_unavailable",
  "mcp_unconfigured",
  "invalid_mcp_target",
]);
const RATE = new Set(["RATE_LIMIT", "rate_limited"]);
const INPUT = new Set([
  "INVALID_INPUT",
  "invalid_input",
  "invalid_json",
  "invalid_url",
  "invalid_body",
  "content_type",
  "too_large",
]);
const NETWORK = new Set(["NETWORK_ERROR", "network_error"]);
const UPSTREAM = new Set([
  "UPSTREAM_ERROR",
  "upstream_401",
  "upstream_403",
  "upstream_error",
]);

export function errorCategory(code: string): ErrorCategory {
  if (AUTH.has(code)) return ERROR_CATEGORY.AUTH_ERROR;
  if (PERMISSION.has(code)) return ERROR_CATEGORY.PERMISSION_ERROR;
  if (TIMEOUT.has(code)) return ERROR_CATEGORY.TOOL_TIMEOUT;
  if (UNAVAILABLE.has(code)) return ERROR_CATEGORY.TOOL_UNAVAILABLE;
  if (RATE.has(code)) return ERROR_CATEGORY.RATE_LIMIT;
  if (INPUT.has(code)) return ERROR_CATEGORY.INVALID_INPUT;
  if (NETWORK.has(code)) return ERROR_CATEGORY.NETWORK_ERROR;
  if (UPSTREAM.has(code) || code.startsWith("upstream_"))
    return ERROR_CATEGORY.UPSTREAM_ERROR;
  return ERROR_CATEGORY.UNKNOWN;
}
