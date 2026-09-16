import { randomUUID } from "node:crypto";
import type {
  BudgetMode,
  ExecutionPlan,
  PlanStep,
  StructuredGoal,
} from "../../contracts";
import type { RoutedTool } from "./tool-router";
import { fallbacksFromRoutes } from "./fallback";
import { isFastTier } from "./intent";

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
  if (isFastTier(goal.intentTier)) {
    return {
      summary: goal.goal.slice(0, 180),
      budgetMode: "fast",
      steps: [
        step(
          "直接回覆",
          "依最近對話直接回答，不展開研究、靈感或 Canva 流程。",
          null,
          null,
        ),
      ],
      fallbacks: [],
    };
  }
  const campus = routes.find((item) => item.id === "campus");
  const research = routes.find((item) => item.id === "research");
  const club = routes.find((item) => item.id === "club_knowledge");
  const galley = routes.find((item) => item.id === "galley");
  const sourceRoute = campus || research;
  const steps: PlanStep[] = [
    step("讀取專案上下文", "確認目前專案、素材與近期對話。", "context_engine", null),
    step("讀取共用記憶", "只帶入相關、近期、已確認的記憶，不把整庫塞進提示。", "shared_memory", null),
  ];
  if (club) {
    steps.push(
      step(
        "查禪學社 Drive 知識",
        "先讀已索引的活動、文案與來源；缺資料標 UNKNOWN，不讀通訊錄。",
        club.tool,
        club.fallback,
      ),
    );
  }
  if (goal.requiresImageAnalysis) {
    const image = routes.find((item) => item.id === "image");
    steps.push(
      step(
        "看圖",
        "先讀附件畫面：構圖、層級、對比、文字可讀性。沒讀到像素就標未讀圖。",
        image?.tool || "ask_user",
        image?.fallback || null,
      ),
    );
  }
  if (goal.requiresTamkang || goal.requiresResearch) {
    steps.push(
      step(
        "確認資料來源能力",
        "依 certification 選擇淡江 MCP、已授權網頁或待查官方入口。",
        sourceRoute?.tool || "ask_user",
        sourceRoute?.fallback || null,
      ),
    );
    steps.push(
      step(
        "查資料",
        "執行研究查詢並保存來源；沒有外部 evidence 不得標已完成。",
        sourceRoute?.tool || "hermes_authorized_web",
        sourceRoute?.fallback || "official_web_directory",
      ),
    );
  }
  if (galley) {
    steps.push(
      step(
        "研究情報",
        "來源優先查已連線的研究情報；沒有外部 evidence 不得用記憶填空，也不得假裝已搜完整社群。",
        galley.tool,
        galley.fallback,
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
      step(
        "受眾模擬",
        goal.requiresTamkang
          ? "以淡江新生假設做 SIMULATION，不是真實轉換率。"
          : `以${goal.audience || "目標受眾"}假設做 SIMULATION，不是真實轉換率。`,
        "audience_simulation",
        null,
      ),
    );
  }
  if (goal.requiresDesign || goal.output) {
    steps.push(
      step(
        "編譯視覺規格",
        "依已確認活動事實產出 4:5／9:16／A4 三個概念；缺日期地點標 UNKNOWN，不補造、不出圖。",
        routes.find((item) => item.id === "visual_spec")?.tool ||
          "workspace_get_visual_concepts",
        null,
      ),
    );
    steps.push(
      step("提出創作方向", "給出策略層不同的方向並排序。", "creative_directions", null),
    );
    steps.push(
      step(
        "文案審核",
        "A／B／C 三版與新生視角審核；未確認地點標 UNKNOWN，不發佈。",
        "workspace_review_copy",
        null,
      ),
    );
    steps.push(
      step("Canva 接續", "有授權才製作；否則只交規格。", routes.find((item) => item.id === "design")?.tool || "canva_spec_only", "canva_spec_only"),
    );
    const lumen = routes.find((item) => item.id === "lumen");
    if (lumen) {
      steps.push(
        step(
          "創作台",
          "已連線時由 Hermes 呼叫創作台整理方向與畫板；未連線不得假裝已開畫板。",
          lumen.tool,
          lumen.fallback,
        ),
      );
    }
  }
  const framelab = routes.find((item) => item.id === "framelab");
  if (framelab) {
    steps.push(
      step(
        "動畫",
        "已連線時由 Hermes 讀時間軸／中間張；寫入需確認。未連線不得假裝已改像素。",
        framelab.tool,
        framelab.fallback,
      ),
    );
  }
  const planform = routes.find((item) => item.id === "planform");
  if (planform) {
    steps.push(
      step(
        "場佈",
        "已連線時由 Hermes 跑場佈草稿；需確認後才套用。找不到物件就標 unresolved。",
        planform.tool,
        planform.fallback,
      ),
    );
  }
  steps.push(
    step(
      "最終審查",
      "確認是否回答請求、工具是否失敗、重要主張是否有來源、作品是否存在。只報告結論，不展示思考鏈。",
      null,
      null,
    ),
  );
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
