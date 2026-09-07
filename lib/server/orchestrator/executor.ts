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

export function prepareOrchestration(
  owner: string,
  task: Task,
  conv: Conversation,
  budgetMode: BudgetMode = task.budgetMode || "balanced",
) {
  const goal = interpretGoal(task.input);
  const certifications = getCertification(owner).integrations;
  const routes = routeTools(goal, certifications);
  const plan = buildPlan(goal, routes, budgetMode);
  const context = assembleContext({
    owner,
    projectId: conv.projectId,
    conversation: conv,
    goalText: task.input,
    budgetMode,
  });
  const fallbackNotice = formatFallbacksForUser(plan.fallbacks);
  const instructions = [
    formatContextForInstructions(context),
    formatPlanForInstructions(plan),
    fallbackNotice ? "請向使用者說明：\n" + fallbackNotice : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { goal, plan, routes, context, instructions };
}
