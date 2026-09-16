export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const ErrorTaxonomy = [
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
export type ErrorTaxonomy = (typeof ErrorTaxonomy)[number];

const AUTH = /^(sign_in_required|session_expired|invalid_login|invalid_link|auth_|oauth_|unverified_email|invalid_password)/i;
const PERMISSION = /^(admin_required|permission|forbidden|membership|confirmation_|mcp_target)/i;
const TOOL = /^(tool_unavailable|mcp_|github_is_not_mcp)/i;
const TIMEOUT = /(timeout|timed_out)/i;
const RATE = /^(rate_limited|too_many)/i;
const INPUT = /^(invalid_|content_type|too_large|invalid_json|invalid_body|invalid_url|invalid_id)/i;
const NETWORK = /^(network_error|store_unavailable|gateway_unconfigured)/i;
const UPSTREAM = /^(upstream|email_failed|connect_)/i;

export function taxonomyFor(code: string): ErrorTaxonomy {
  if (code === "rate_limited") return "RATE_LIMIT";
  if (AUTH.test(code)) return "AUTH_ERROR";
  if (PERMISSION.test(code)) return "PERMISSION_ERROR";
  if (TIMEOUT.test(code)) return "TOOL_TIMEOUT";
  if (TOOL.test(code)) return "TOOL_UNAVAILABLE";
  if (RATE.test(code)) return "RATE_LIMIT";
  if (INPUT.test(code)) return "INVALID_INPUT";
  if (NETWORK.test(code)) return "NETWORK_ERROR";
  if (UPSTREAM.test(code)) return "UPSTREAM_ERROR";
  return "UNKNOWN";
}
