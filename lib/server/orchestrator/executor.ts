import type { BudgetMode, Conversation, Task } from "../../contracts";
import { interpretGoal } from "./goal";
import { routeTools } from "./tool-router";
import { buildPlan, formatPlanForInstructions } from "./planner";
import { formatFallbacksForUser } from "./fallback";
import { getCertification } from "../certification";
import { seedRegistry } from "../mcp-registry";
import {
  assembleContext,
  formatContextForInstructions,
} from "../context/assembler";
import { CONTEXT_TOKEN_BUDGET } from "../context/budget";
import { shouldFastPlan } from "./intent";

export function prepareOrchestration(
  owner: string,
  task: Task,
  conv: Conversation,
  budgetMode: BudgetMode = task.budgetMode || "balanced",
) {
  const goal = interpretGoal(task.input);
  const fast = shouldFastPlan(goal);
  const effectiveBudget: BudgetMode = fast ? "fast" : budgetMode;
  const certifications = getCertification(owner).integrations;
  let mcp: Array<{ id: string; status: string; tools: Array<{ name: string }> }> =
    [];
  try {
    mcp = seedRegistry().map((item) => ({
      id: item.id,
      status: item.status,
      tools: item.tools.map((tool) => ({ name: tool.name })),
    }));
  } catch {
    mcp = [];
  }
  const routes = routeTools(goal, certifications, mcp);
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
