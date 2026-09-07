import type { ExecutionPlan, FallbackRecord } from "../../contracts";

export function planEvents(plan: ExecutionPlan) {
  return plan.steps.map((step) => ({
    kind: "plan.step" as const,
    title: step.title,
    status: step.status,
    tool: step.tool,
    fallback: step.fallback,
  }));
}

export function fallbackEvents(records: FallbackRecord[]) {
  return records.map((item) => ({
    kind: "fallback" as const,
    title: item.userVisible,
    from: item.from,
    to: item.to,
  }));
}
