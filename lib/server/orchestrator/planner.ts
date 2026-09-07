import { randomUUID } from "node:crypto";
import type {
  BudgetMode,
  ExecutionPlan,
  PlanStep,
  StructuredGoal,
} from "../../contracts";
import type { RoutedTool } from "./tool-router";
import { fallbacksFromRoutes } from "./fallback";

function step(
  title: string,
  purpose: string,
  tool: string | null,
  fallback: string | null,
  dependencies: string[] = [],
): PlanStep {
  return {
    id: randomUUID(),
    title,
    purpose,
    dependencies,
    agent: "general",
    tool,
    fallback,
    status: "pending",
  };
}

export function buildPlan(
  goal: StructuredGoal,
  routes: RoutedTool[],
  budgetMode: BudgetMode = "balanced",
): ExecutionPlan {
  const campus = routes.find((item) => item.id === "campus");
  const steps: PlanStep[] = [
    step("讀取專案上下文", "確認目前專案、素材與近期對話。", "context_engine", null),
    step("讀取共用記憶", "只帶入相關、近期、已確認的記憶，不把整庫塞進提示。", "shared_memory", null),
  ];
  if (goal.requiresTamkang || goal.requiresResearch) {
    steps.push(
      step(
        "確認資料來源能力",
        "依 certification 選擇淡江 MCP、已授權網頁或待查官方入口。",
        campus?.tool || "ask_user",
        campus?.fallback || null,
      ),
    );
    steps.push(
      step(
        "查資料",
        "執行研究查詢並保存來源；沒有外部 evidence 不得標已完成。",
        campus?.tool || "hermes_authorized_web",
        "official_web_directory",
      ),
    );
  }
  if (goal.requiresInspiration) {
    steps.push(
      step("找靈感", "先讀已收藏靈感，再搜尋已授權來源。", "project_inspiration_then_web", "ask_user"),
    );
  }
  if (goal.requiresAudienceEvaluation) {
    steps.push(
      step("受眾模擬", "以淡江新生假設做 SIMULATION，不是真實轉換率。", "audience_simulation", null),
    );
  }
  if (goal.requiresDesign || goal.output) {
    steps.push(
      step("提出創作方向", "給出策略層不同的方向並排序。", "creative_directions", null),
    );
    steps.push(
      step("Canva 接續", "有授權才製作；否則只交規格。", routes.find((item) => item.id === "design")?.tool || "canva_spec_only", "canva_spec_only"),
    );
  }
  steps.push(step("最終審查", "列出來源、未完成步驟與需要你確認的操作。", null, null));
  return {
    summary: goal.goal.slice(0, 180),
    budgetMode,
    steps,
    fallbacks: fallbacksFromRoutes(routes),
  };
}

export function formatPlanForUser(plan: ExecutionPlan) {
  return plan.steps
    .map((item, index) => `${index + 1}. ${item.title} — ${item.purpose}`)
    .join("\n");
}

export function formatPlanForInstructions(plan: ExecutionPlan) {
  return [
    "可見執行計畫（不是內部思考）：",
    formatPlanForUser(plan),
    plan.fallbacks.length
      ? "已說明的備援：\n" + plan.fallbacks.map((item) => item.userVisible).join("\n")
      : "目前沒有工具備援。",
    "禁止偷偷換工具。查不到時標未知，不得自行補資料。",
  ].join("\n");
}
