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
const TOOL = /^(tool_unavailable|empty_tool_result|mcp_|github_is_not_mcp|hermes_unconfigured)/i;
const TIMEOUT = /(timeout|timed_out)/i;
const RATE = /^(rate_limited|too_many)/i;
const INPUT = /^(invalid_|content_type|too_large|invalid_json|invalid_body|invalid_url|invalid_id)/i;
const NETWORK = /^(network_error|store_unavailable|gateway_unconfigured)/i;
const UPSTREAM = /^(upstream|email_failed|connect_|hermes_not_ready|interrupted)/i;

export const STUDENT_HERMES_UNCONFIGURED =
  "Hermes 還沒連上。請到設定的連線頁。";
export const STUDENT_HERMES_UNAVAILABLE = "現在沒辦法連到 Hermes。";

const HERMES_ENGINEERING =
  /環境變數|HERMES_API|憑證參照|請在後端|金鑰無效|vault\.key|Bearer |Authorization/i;

/** Chat and member APIs never name env vars, keys, or vault internals. */
export function studentHermesError(message: string, code?: string): string {
  if (
    code === "hermes_unconfigured" ||
    code === "hermes_not_ready" ||
    code === "invalid_credential_ref"
  )
    return STUDENT_HERMES_UNCONFIGURED;
  if (
    code &&
    /^(connect_timeout|network_error|interrupted|upstream_)/.test(code)
  )
    return STUDENT_HERMES_UNAVAILABLE;
  if (HERMES_ENGINEERING.test(message)) return STUDENT_HERMES_UNAVAILABLE;
  return message;
}

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

/** HTTP 200 with no readable payload is not success. */
export function isEmptyToolResult(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.length) return true;
  if (keys.length === 1 && "content" in record)
    return isEmptyToolResult(record.content);
  if (keys.length === 1 && "result" in record)
    return isEmptyToolResult(record.result);
  return false;
}
