import { DEFAULT_BUDGET } from "./budgets";
import type { AgentRole } from "./agents";

export interface Handoff {
  from: AgentRole;
  to: AgentRole;
  depth: number;
  reason: string;
}

const ALLOWED: Record<AgentRole, AgentRole[]> = {
  general: ["research", "creative", "tku", "design", "social", "reviewer"],
  research: ["tku", "reviewer"],
  creative: ["design", "reviewer"],
  tku: ["research"],
  design: ["reviewer"],
  social: ["reviewer"],
  development: ["general"],
  reviewer: [],
};

export function canHandoff(from: AgentRole, to: AgentRole, depth: number) {
  if (depth >= DEFAULT_BUDGET.maxAgentDepth) return false;
  if (from === to) return false;
  return ALLOWED[from].includes(to);
}

export function planHandoffs(prompt: string): Handoff[] {
  const planned: Handoff[] = [];
  const add = (to: AgentRole, reason: string) => {
    if (planned.length >= DEFAULT_BUDGET.maxSubtasks) return;
    if (canHandoff("general", to, 1))
      planned.push({ from: "general", to, depth: 1, reason });
  };
  if (/淡江|淡水|新生|克難坡/.test(prompt)) add("tku", "校園與在地研究");
  if (/靈感|參考|IG|Pinterest|海報|文宣/.test(prompt))
    add("research", "靈感與來源研究");
  if (/方向|創意|文案|海報|文宣/.test(prompt)) add("creative", "策略方向");
  if (/Canva|設計|草稿/.test(prompt)) add("design", "設計製作");
  if (/IG|Instagram|貼文|hashtag/.test(prompt)) add("social", "社群草稿");
  if (/反向|受眾|路人|評測/.test(prompt)) add("reviewer", "Audience Twin 評測");
  return planned.slice(0, DEFAULT_BUDGET.maxSubtasks);
}
