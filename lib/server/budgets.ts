export interface TaskBudget {
  tokens: number;
  toolCalls: number;
  sources: number;
  durationMs: number;
  revisionRounds: number;
  directions: number;
  audienceRoles: number;
  maxAgentDepth: number;
  maxSubtasks: number;
}

export const DEFAULT_BUDGET: TaskBudget = {
  tokens: 0,
  toolCalls: 40,
  sources: 30,
  durationMs: 900_000,
  revisionRounds: 3,
  directions: 5,
  audienceRoles: 5,
  maxAgentDepth: 2,
  maxSubtasks: 8,
};

export function envNumber(
  name: string,
  fallback: number,
  allowZero = false,
) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  if (value === 0) return allowZero ? 0 : fallback;
  return value;
}

export function isUnlimited(limit: number) {
  return !Number.isFinite(limit) || limit <= 0;
}

export function effectiveLimit(limit: number) {
  return isUnlimited(limit) ? Number.MAX_SAFE_INTEGER : limit;
}

export function uploadByteLimit() {
  return envNumber("CONSOLE_MAX_UPLOAD_BYTES", 0, true);
}

export function storageByteLimit() {
  return envNumber("CONSOLE_MAX_STORAGE_BYTES", 0, true);
}

export function budgetFromEnv(): TaskBudget {
  const number = (name: string, fallback: number) =>
    envNumber(name, fallback, false);
  return {
    tokens: envNumber(
      "CONSOLE_TASK_TOKEN_BUDGET",
      DEFAULT_BUDGET.tokens,
      true,
    ),
    toolCalls: number("CONSOLE_MAX_TOOL_CALLS", DEFAULT_BUDGET.toolCalls),
    sources: number("CONSOLE_MAX_SOURCES", DEFAULT_BUDGET.sources),
    durationMs: number("HERMES_TASK_TIMEOUT_MS", DEFAULT_BUDGET.durationMs),
    revisionRounds: number(
      "CONSOLE_MAX_REVISIONS",
      DEFAULT_BUDGET.revisionRounds,
    ),
    directions: number("CONSOLE_MAX_DIRECTIONS", DEFAULT_BUDGET.directions),
    audienceRoles: number(
      "CONSOLE_MAX_AUDIENCE_ROLES",
      DEFAULT_BUDGET.audienceRoles,
    ),
    maxAgentDepth: 2,
    maxSubtasks: number("CONSOLE_MAX_SUBTASKS", DEFAULT_BUDGET.maxSubtasks),
  };
}

export function withinBudget(
  used: Partial<TaskBudget>,
  budget: TaskBudget = DEFAULT_BUDGET,
) {
  if ((used.sources || 0) > budget.sources) return "sources";
  if ((used.directions || 0) > budget.directions) return "directions";
  if ((used.audienceRoles || 0) > budget.audienceRoles) return "audienceRoles";
  if ((used.revisionRounds || 0) > budget.revisionRounds)
    return "revisionRounds";
  if ((used.toolCalls || 0) > budget.toolCalls) return "toolCalls";
  if (!isUnlimited(budget.tokens) && (used.tokens || 0) > budget.tokens)
    return "tokens";
  return null;
}
