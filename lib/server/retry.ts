import { autoAllowed, permissionClass } from "./permissions";
import { ApiError } from "./security";

export type RetryClock = {
  wait: (ms: number) => Promise<void>;
  random: () => number;
};

const BLOCKED_CODES = new Set([
  "empty_output",
  "empty_stream",
  "tool_budget_exceeded",
  "concurrency_limit",
]);

export function safeToRetry(toolName: string) {
  return permissionClass(toolName) === "read";
}

export function isTransientToolError(error: unknown) {
  if (!(error instanceof ApiError)) return false;
  if (BLOCKED_CODES.has(error.code)) return false;
  if (
    error.category === "AUTH_ERROR" ||
    error.category === "PERMISSION_ERROR" ||
    error.category === "INVALID_INPUT" ||
    error.category === "TOOL_UNAVAILABLE"
  )
    return false;
  if (
    error.category === "RATE_LIMIT" ||
    error.category === "TOOL_TIMEOUT" ||
    error.category === "NETWORK_ERROR"
  )
    return true;
  return [429, 503, 504].includes(error.status);
}

export async function withSafeRetry<T>(
  run: () => Promise<T>,
  options: {
    toolName: string;
    maxAttempts?: number;
    clock?: RetryClock;
  },
): Promise<T> {
  if (!safeToRetry(options.toolName) || !autoAllowed(options.toolName))
    return run();
  const max = Math.max(1, options.maxAttempts ?? 3);
  const wait =
    options.clock?.wait || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = options.clock?.random || Math.random;
  let last: unknown;
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (attempt === max - 1 || !isTransientToolError(error)) throw error;
      const backoff = 200 * 2 ** attempt;
      await wait(backoff + Math.floor(random() * 100));
    }
  }
  throw last;
}
