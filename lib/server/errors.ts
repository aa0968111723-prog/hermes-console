export const ERROR_CATEGORIES = [
  "AUTH_ERROR",
  "PERMISSION_ERROR",
  "TOOL_UNAVAILABLE",
  "TOOL_TIMEOUT",
  "RATE_LIMIT",
  "INVALID_INPUT",
  "NETWORK_ERROR",
  "UPSTREAM_ERROR",
  "UNKNOWN",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

const CODE_CATEGORY: Record<string, ErrorCategory> = {
  sign_in_required: "AUTH_ERROR",
  session_expired: "AUTH_ERROR",
  invalid_login: "AUTH_ERROR",
  invalid_link: "AUTH_ERROR",
  gateway_required: "AUTH_ERROR",
  gateway_unconfigured: "AUTH_ERROR",
  AUTH_ERROR: "AUTH_ERROR",
  admin_required: "PERMISSION_ERROR",
  PERMISSION_ERROR: "PERMISSION_ERROR",
  origin_rejected: "PERMISSION_ERROR",
  confirmation_required: "PERMISSION_ERROR",
  confirmation_invalid: "PERMISSION_ERROR",
  confirmation_mismatch: "PERMISSION_ERROR",
  rate_limited: "RATE_LIMIT",
  RATE_LIMIT: "RATE_LIMIT",
  invalid_input: "INVALID_INPUT",
  invalid_json: "INVALID_INPUT",
  invalid_body: "INVALID_INPUT",
  invalid_url: "INVALID_INPUT",
  INVALID_INPUT: "INVALID_INPUT",
  content_type: "INVALID_INPUT",
  too_large: "INVALID_INPUT",
  tool_unavailable: "TOOL_UNAVAILABLE",
  TOOL_UNAVAILABLE: "TOOL_UNAVAILABLE",
  tool_timeout: "TOOL_TIMEOUT",
  TOOL_TIMEOUT: "TOOL_TIMEOUT",
  ssrf_rejected: "NETWORK_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  store_unavailable: "UPSTREAM_ERROR",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
};

export function errorCategory(code: string): ErrorCategory {
  return CODE_CATEGORY[code] || "UNKNOWN";
}
