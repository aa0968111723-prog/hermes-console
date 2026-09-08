import type { BudgetMode, Conversation, Task } from "../../contracts";
import { interpretGoal } from "./goal";
import { routeTools } from "./tool-router";
import { buildPlan, formatPlanForInstructions } from "./planner";
import { formatFallbacksForUser } from "./fallback";
import { getCertification } from "../certification";
import {
  assembleContext,
  formatContextForInstructions,
} from "../context/assembler";
import { CONTEXT_TOKEN_BUDGET } from "../context/budget";
import { isFastTier } from "./intent";

export function prepareOrchestration(
  owner: string,
  task: Task,
  conv: Conversation,
  budgetMode: BudgetMode = task.budgetMode || "balanced",
) {
  const goal = interpretGoal(task.input);
  const fast = isFastTier(goal.intentTier);
  const effectiveBudget: BudgetMode = fast ? "fast" : budgetMode;
  const certifications = getCertification(owner).integrations;
  const routes = routeTools(goal, certifications);
  const plan = buildPlan(goal, routes, effectiveBudget);
  const context = fast
    ? {
        items: [],
        used: 0,
        limit: CONTEXT_TOKEN_BUDGET.fast,
        mode: "fast" as const,
      }
    : assembleContext({
        owner,
        projectId: conv.projectId,
        conversation: conv,
        goalText: task.input,
        budgetMode: effectiveBudget,
      });
  const fallbackNotice = formatFallbacksForUser(plan.fallbacks);
  const instructions = fast
    ? formatPlanForInstructions(plan)
    : [
        formatContextForInstructions(context),
        formatPlanForInstructions(plan),
        fallbackNotice ? "請向使用者說明：\n" + fallbackNotice : "",
      ]
        .filter(Boolean)
        .join("\n\n");
  return { goal, plan, routes, context, instructions, intentTier: goal.intentTier };
}
