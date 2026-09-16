import { ApiError } from "./errors";

const PLACEHOLDER_SUMMARIES = new Set([
  "Hermes 回報工具活動。",
  "工具已回傳結果；非同步工作需再查回，不等於製作已完成。",
  "後端收到真實 MCP 工具呼叫。",
]);

/** HTTP 200 / `{}` / blank strings are not success. Empty arrays inside a named payload are. */
export function isEmptyToolResult(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number" || typeof value === "boolean") return false;
  if (Array.isArray(value)) return false;
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec);
    if (keys.length === 0) return true;
    return keys.every((key) => {
      const item = rec[key];
      if (item == null) return true;
      if (typeof item === "string") return item.trim() === "";
      if (Array.isArray(item)) return false;
      if (typeof item === "object") return isEmptyToolResult(item);
      return false;
    });
  }
  return false;
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
  if (!isEmptyToolResult(event.result)) return true;
  const summary = event.summary.trim();
  return summary.length > 0 && !PLACEHOLDER_SUMMARIES.has(summary);
}
