import type { Message } from "../../contracts";
import { estimateTokens } from "./provenance";

export const HISTORY_WINDOW_MIN = 8;
export const HISTORY_WINDOW_MAX = 12;
export const DEFAULT_HISTORY_WINDOW = 10;
export const DEFAULT_HISTORY_TOKEN_BUDGET = 4_000;

export function historyWindowK() {
  const raw = Number(process.env.CONSOLE_HISTORY_WINDOW);
  if (
    Number.isFinite(raw) &&
    raw >= HISTORY_WINDOW_MIN &&
    raw <= HISTORY_WINDOW_MAX
  )
    return Math.floor(raw);
  return DEFAULT_HISTORY_WINDOW;
}

export function historyTokenBudget(taskBudget?: number | null) {
  const raw = Number(process.env.CONSOLE_HISTORY_TOKEN_BUDGET);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  if (taskBudget && taskBudget > 0)
    return Math.min(DEFAULT_HISTORY_TOKEN_BUDGET, Math.floor(taskBudget * 0.4));
  return DEFAULT_HISTORY_TOKEN_BUDGET;
}

export function contentTokens(content: unknown): number {
  if (typeof content === "string") return estimateTokens(content);
  if (Array.isArray(content)) {
    return content.reduce((sum, part) => {
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      )
        return sum + estimateTokens((part as { text: string }).text);
      return sum + 200;
    }, 0);
  }
  if (content == null) return 0;
  return estimateTokens(JSON.stringify(content));
}

function messagesTokens(messages: Array<{ content?: unknown }>) {
  return messages.reduce((sum, item) => sum + contentTokens(item.content), 0);
}

export function windowConversationHistory(
  messages: Message[],
  options?: {
    k?: number;
    tokenBudget?: number;
    summary?: string | null;
  },
) {
  const prior = messages.slice(0, -1);
  const k = options?.k ?? historyWindowK();
  const tokenBudget = options?.tokenBudget ?? historyTokenBudget();
  let windowed = prior.slice(-k);
  while (windowed.length > 1 && messagesTokens(windowed) > tokenBudget)
    windowed = windowed.slice(1);
  const omitted = Math.max(0, prior.length - windowed.length);
  const summary = options?.summary?.trim() || null;
  return {
    messages: windowed,
    omitted,
    summary: omitted > 0 ? summary : null,
    tokens: messagesTokens(windowed),
  };
}

export function estimateTaskInputTokens(
  instructions: string,
  history: Array<{ content?: unknown }>,
  input: string,
) {
  return (
    estimateTokens(instructions) +
    messagesTokens(history) +
    estimateTokens(input)
  );
}

export function fitTaskInputBudget<T extends { content?: unknown }>(args: {
  instructions: string;
  history: T[];
  input: string;
  limit: number;
}) {
  let history = args.history;
  let estimated = estimateTaskInputTokens(
    args.instructions,
    history,
    args.input,
  );
  let trimmed = false;
  while (estimated > args.limit && history.length > 0) {
    history = history.slice(1);
    trimmed = true;
    estimated = estimateTaskInputTokens(
      args.instructions,
      history,
      args.input,
    );
  }
  return {
    instructions: args.instructions,
    history,
    estimated,
    trimmed,
    exceeded: estimated > args.limit,
  };
}
