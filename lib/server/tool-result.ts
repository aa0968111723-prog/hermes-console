import { ApiError } from "./errors";

const PLACEHOLDER_SUMMARIES = new Set([
  "Hermes 回報工具活動。",
  "工具已回傳結果；非同步工作需再查回，不等於製作已完成。",
  "後端收到真實 MCP 工具呼叫。",
]);

/** HTTP 200 / `{}` / blank strings are not success. Empty arrays inside a named payload are. */
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
  return keys.every((key) => {
    const nested = record[key];
    if (Array.isArray(nested)) return false;
    if (typeof nested === "boolean" || typeof nested === "number") return false;
    return isEmptyToolResult(nested);
  });
}

export function assertMeaningfulToolResult(
  value: unknown,
  imageData?: string | null,
) {
  if (imageData) return;
  if (isEmptyToolResult(value))
    throw new ApiError(
      502,
      "empty_tool_result",
      "工具回報成功，但沒有可用內容。",
    );
}

export function toolEventHasUsableOutput(event: {
  result: unknown;
  summary: string;
}) {
  if (event.result != null) return !isEmptyToolResult(event.result);
  const summary = event.summary.trim();
  return summary.length > 0 && !PLACEHOLDER_SUMMARIES.has(summary);
}
