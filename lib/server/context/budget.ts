import type { BudgetMode } from "../../contracts";
import { rankContext } from "./ranking";
import type { ContextItem } from "./provenance";

export const CONTEXT_TOKEN_BUDGET: Record<BudgetMode, number> = {
  fast: 900,
  balanced: 1800,
  deep: 3600,
};

export function budgetLabel(mode: BudgetMode) {
  return mode === "fast" ? "快速" : mode === "deep" ? "深入" : "標準";
}

export function fitBudget(items: ContextItem[], mode: BudgetMode = "balanced") {
  const limit = CONTEXT_TOKEN_BUDGET[mode];
  const selected: ContextItem[] = [];
  let used = 0;
  for (const item of rankContext(items)) {
    if (used + item.tokens > limit) continue;
    selected.push(item);
    used += item.tokens;
  }
  return { items: selected, used, limit, mode };
}
