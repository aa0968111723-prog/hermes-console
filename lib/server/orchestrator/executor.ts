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
import { getMcp, seedRegistry } from "../mcp-registry";
import { countImageAttachments } from "../materials";
import { formatPlannerCatalog } from "./catalog";

export function prepareOrchestration(
  owner: string,
  task: Task,
  conv: Conversation,
  budgetMode: BudgetMode = task.budgetMode || "balanced",
) {
  const goal = interpretGoal(task.input, {
    attachmentCount: task.attachments.length,
    imageAttachmentCount: countImageAttachments(owner, task.attachments),
    attachmentIds: task.attachments,
  });
  const fast = isFastTier(goal.intentTier);
  const effectiveBudget: BudgetMode = fast ? "fast" : budgetMode;
  const certifications = getCertification(owner).integrations;
  const galley = getMcp("galley");
  const lumen = getMcp("lumen");
  const routes = routeTools(goal, certifications, {
    galley: { status: galley?.status || "unconfigured" },
    lumen: { status: lumen?.status || "unconfigured" },
  });
  const plan = buildPlan(goal, routes, effectiveBudget);
  const catalog = fast ? "" : formatPlannerCatalog(seedRegistry());
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
        catalog,
      ]
        .filter(Boolean)
        .join("\n\n");
  return { goal, plan, routes, context, instructions, intentTier: goal.intentTier };
}
