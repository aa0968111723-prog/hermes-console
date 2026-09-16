export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

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
  store_unavailable: "NETWORK_ERROR",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  empty_output: "UPSTREAM_ERROR",
  empty_stream: "UPSTREAM_ERROR",
  tool_failed: "UPSTREAM_ERROR",
  tool_budget_exceeded: "RATE_LIMIT",
  hermes_not_ready: "TOOL_UNAVAILABLE",
  hermes_unconfigured: "TOOL_UNAVAILABLE",
  unknown_tool: "TOOL_UNAVAILABLE",
  empty_tool_result: "TOOL_UNAVAILABLE",
  permission_denied: "PERMISSION_ERROR",
  membership_required: "PERMISSION_ERROR",
};

export function errorCategory(code: string): ErrorCategory {
  if (CODE_CATEGORY[code]) return CODE_CATEGORY[code];
  if (/_unconfigured$|unknown_tool|hermes_not_ready|tool_unavailable/.test(code))
    return "TOOL_UNAVAILABLE";
  if (/timeout/.test(code)) return "TOOL_TIMEOUT";
  if (/budget|concurrency_limit/.test(code)) return "RATE_LIMIT";
  if (/empty_|_empty$|_failed$|invalid_stream|invalid_response|probe_failed/.test(code))
    return "UPSTREAM_ERROR";
  return "UNKNOWN";
}

export type ErrorTaxonomy = ErrorCategory;

export function taxonomyFor(code: string): ErrorCategory {
  if (code === "empty_tool_result") return "TOOL_UNAVAILABLE";
  if (code === "hermes_not_ready") return "UPSTREAM_ERROR";
  if (code === "hermes_unconfigured") return "TOOL_UNAVAILABLE";
  if (code === "store_unavailable") return "NETWORK_ERROR";
  return errorCategory(code);
}

export const STUDENT_HERMES_UNCONFIGURED =
  "Hermes 還沒準備好。可以先找靈感，或稍後再試。";
export const STUDENT_HERMES_UNAVAILABLE = "現在沒辦法連到 Hermes。";
export const STUDENT_IMAGE_UNVERIFIED =
  "圖片已保存，但還沒辦法讀圖。可以先拿掉附件，或改問這張哪裡可以改。";

const HERMES_ENGINEERING =
  /環境變數|HERMES_API|憑證參照|請在後端|金鑰無效|vault\.key|Bearer |Authorization|部署服務|部署端|圖片輸入|服務日誌|工具授權|原始會話|請至 Hermes|Agent／|權限與 profile|客戶端執行工具/i;

export function studentHermesError(message: string, code?: string): string {
  if (
    code === "hermes_unconfigured" ||
    code === "hermes_not_ready" ||
    code === "invalid_credential_ref"
  )
    return STUDENT_HERMES_UNCONFIGURED;
  if (code === "images_unverified") return STUDENT_IMAGE_UNVERIFIED;
  if (
    code &&
    /^(connect_timeout|network_error|interrupted|upstream_)/.test(code)
  )
    return STUDENT_HERMES_UNAVAILABLE;
  if (HERMES_ENGINEERING.test(message)) return STUDENT_HERMES_UNAVAILABLE;
  return message;
}

export { isEmptyToolResult } from "./tool-result";
