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
  "session_not_found",
  "current_session",
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
  "permission_denied",
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
  "mcp_credential_missing",
  "invalid_mcp_target",
  "images_unverified",
  "hermes_not_ready",
  "hermes_unconfigured",
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
const NETWORK = new Set([
  "NETWORK_ERROR",
  "network_error",
  "store_unavailable",
]);
const UPSTREAM = new Set([
  "UPSTREAM_ERROR",
  "upstream_401",
  "upstream_403",
  "upstream_error",
  "empty_tool_result",
  "empty_output",
  "empty_stream",
]);

export function errorCategory(code: string): ErrorCategory {
  if (AUTH.has(code)) return ERROR_CATEGORY.AUTH_ERROR;
  if (PERMISSION.has(code)) return ERROR_CATEGORY.PERMISSION_ERROR;
  if (TIMEOUT.has(code)) return ERROR_CATEGORY.TOOL_TIMEOUT;
  if (UNAVAILABLE.has(code) || /_unconfigured$/.test(code))
    return ERROR_CATEGORY.TOOL_UNAVAILABLE;
  if (RATE.has(code)) return ERROR_CATEGORY.RATE_LIMIT;
  if (INPUT.has(code)) return ERROR_CATEGORY.INVALID_INPUT;
  if (NETWORK.has(code)) return ERROR_CATEGORY.NETWORK_ERROR;
  if (UPSTREAM.has(code) || code.startsWith("upstream_"))
    return ERROR_CATEGORY.UPSTREAM_ERROR;
  return ERROR_CATEGORY.UNKNOWN;
}

export type ErrorTaxonomy = ErrorCategory;

export function taxonomyFor(code: string): ErrorCategory {
  if (code === "empty_tool_result") return ERROR_CATEGORY.TOOL_UNAVAILABLE;
  if (code === "hermes_not_ready") return ERROR_CATEGORY.UPSTREAM_ERROR;
  if (code === "hermes_unconfigured") return ERROR_CATEGORY.TOOL_UNAVAILABLE;
  return errorCategory(code);
}

export const STUDENT_HERMES_UNCONFIGURED =
  "Hermes 還沒準備好。可以先找靈感，或稍後再試。";
export const STUDENT_HERMES_UNAVAILABLE = "現在沒辦法連到 Hermes。";
export const STUDENT_IMAGE_UNVERIFIED =
  "圖片已保存，但還沒辦法讀圖。可以先拿掉附件，或改問這張哪裡可以改。";
export const STUDENT_TOKEN_BUDGET = "這次內容太長。請開新對話再試一次。";

const HERMES_ENGINEERING =
  /環境變數|HERMES_API|憑證參照|請在後端|金鑰無效|vault\.key|Bearer |Authorization|部署服務|部署端|圖片輸入|服務日誌|工具授權|原始會話|請至 Hermes|Agent／|權限與 profile|客戶端執行工具|tokens，超過上限|已裁切歷史/i;

export const STUDENT_BUDGET_TRACE =
  "內容較長，已整理成這次能送出的範圍。";
export const STUDENT_PLAN_TRACE = "已整理目標與可見執行計畫。";

const STORED_BUDGET_TRACE = /任務輸入估計|\d+\s*\/\s*\d+\s*tokens\b/i;
const STORED_INTENT_TRACE = /budgetMode=|意圖 continue/;

/** Chat and member APIs never name env vars, keys, or vault internals. */
export function studentHermesError(message: string, code?: string): string {
  if (
    code === "hermes_unconfigured" ||
    code === "hermes_not_ready" ||
    code === "invalid_credential_ref"
  )
    return STUDENT_HERMES_UNCONFIGURED;
  if (code === "images_unverified") return STUDENT_IMAGE_UNVERIFIED;
  if (code === "token_budget_exceeded") return STUDENT_TOKEN_BUDGET;
  if (/tokens，超過上限|已裁切歷史/.test(message)) return STUDENT_TOKEN_BUDGET;
  if (
    code &&
    /^(connect_timeout|network_error|interrupted|upstream_)/.test(code)
  )
    return STUDENT_HERMES_UNAVAILABLE;
  if (HERMES_ENGINEERING.test(message)) return STUDENT_HERMES_UNAVAILABLE;
  return message;
}

/** Stored event summaries: same student rewrite as errors, plus leftover budget traces. */
export function studentFacingSummary(summary: string): string {
  const asError = studentHermesError(summary);
  if (asError !== summary) return asError;
  if (STORED_BUDGET_TRACE.test(summary)) return STUDENT_BUDGET_TRACE;
  if (STORED_INTENT_TRACE.test(summary)) return STUDENT_PLAN_TRACE;
  return summary;
}

/** Rewrite stored rows for student APIs. Does not mutate the store. */
export function studentFacingTask<
  T extends {
    error: string | null;
    observationError: string | null;
    events: Array<{ error: string | null; summary: string }>;
  },
>(task: T): T {
  return {
    ...task,
    error: task.error ? studentFacingSummary(task.error) : null,
    observationError: task.observationError
      ? studentFacingSummary(task.observationError)
      : null,
    events: Array.isArray(task.events)
      ? task.events.map((event) => ({
          ...event,
          error: event.error ? studentFacingSummary(event.error) : null,
          summary: event.summary
            ? studentFacingSummary(event.summary)
            : event.summary,
        }))
      : task.events,
  };
}

export { isEmptyToolResult } from "./tool-result";
