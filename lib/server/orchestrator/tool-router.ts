import type { IntegrationCertification } from "../certification/types";
import type { StructuredGoal } from "../../contracts";
import { needsZenclubKnowledge } from "../zenclub";

export type ToolAvailability =
  | "available"
  | "partial"
  | "unconfigured"
  | "failed"
  | "unknown";

export type RoutedTool = {
  id: string;
  tool: string;
  reason: string;
  fallback: string | null;
  availability?: ToolAvailability;
};

export type McpHint = {
  id: string;
  status: string;
  tools?: Array<{ name: string }>;
};

function capStatus(cert: IntegrationCertification | undefined, id: string) {
  return cert?.capabilities.find((item) => item.id === id)?.status;
}

function mcpEntry(mcp: McpHint[], id: string) {
  const aliases = id === "tamkang" ? ["tamkang", "tku"] : [id];
  return mcp.find((item) => aliases.includes(item.id));
}

function asAvailability(status: string | undefined): ToolAvailability {
  if (status === "verified" || status === "available") return "available";
  if (status === "partial" || status === "connected") return "partial";
  if (status === "failed") return "failed";
  if (status === "unconfigured") return "unconfigured";
  return "unknown";
}

function mcpReady(status: string | undefined) {
  return (
    status === "verified" ||
    status === "partial" ||
    status === "connected" ||
    status === "available"
  );
}

export function routeTools(
  goal: StructuredGoal,
  certifications: IntegrationCertification[],
  mcp: McpHint[] | Record<string, string> = [],
): RoutedTool[] {
  if (!Array.isArray(mcp)) {
    mcp = Object.entries(mcp).map(([id, status]) => ({ id, status }));
  }
  const tamkang = certifications.find((item) => item.id === "tamkang");
  const hermes = certifications.find((item) => item.id === "hermes");
  const canva = certifications.find((item) => item.id === "canva");
  const routes: RoutedTool[] = [];
  const hermesChat =
    capStatus(hermes, "hermes.chat") === "verified" ||
    capStatus(hermes, "hermes.api") === "reachable";
  const galley = mcpEntry(mcp, "galley");
  const galleyNames = (galley?.tools || [])
    .map((item) => item.name)
    .filter(Boolean)
    .slice(0, 8);

  if (needsZenclubKnowledge(goal.goal)) {
    routes.push({
      id: "club_knowledge",
      tool: "zenclub_drive_index",
      reason:
        "社團內部事實優先查禪學社 Drive 知識索引，不得用 IG 或合理推測補日期地點。",
      fallback: null,
      availability: "available",
    });
  }

  if (goal.requiresTamkang) {
    const reachable =
      capStatus(tamkang, "tamkang.reachable") === "reachable" ||
      capStatus(tamkang, "tamkang.tools") === "partial" ||
      capStatus(tamkang, "tamkang.tools") === "verified" ||
      mcpReady(mcpEntry(mcp, "tamkang")?.status);
    if (reachable) {
      routes.push({
        id: "campus",
        tool: "tamkang_mcp",
        reason: "淡江資料優先使用已列出的 Tamkang MCP。",
        fallback: "hermes_authorized_web",
        availability: asAvailability(
          mcpEntry(mcp, "tamkang")?.status || "partial",
        ),
      });
    } else if (hermesChat) {
      routes.push({
        id: "campus",
        tool: "hermes_authorized_web",
        reason: "淡江 MCP 目前不可用，改用 Hermes 已授權網頁來源。",
        fallback: "official_web_directory",
        availability: "partial",
      });
    } else {
      routes.push({
        id: "campus",
        tool: "ask_user",
        reason:
          "淡江 MCP 與 Hermes 網頁研究都尚未驗證，需要使用者提供來源或稍後再試。",
        fallback: null,
        availability: "unconfigured",
      });
    }
  }

  if (goal.requiresResearch || goal.requiresInspiration) {
    if (mcpReady(galley?.status)) {
      routes.push({
        id: "galley",
        tool: "galley_research",
        reason:
          "GALLEY " +
          asAvailability(galley?.status) +
          (galleyNames.length ? "，工具：" + galleyNames.join("、") : "") +
          "。來源優先；沒有可核對來源時標資料不足，不得填空。",
        fallback: hermesChat ? "hermes_authorized_web" : "ask_user",
        availability: asAvailability(galley?.status),
      });
    } else if (goal.requiresResearch && !goal.requiresTamkang) {
      routes.push({
        id: "research",
        tool: hermesChat ? "hermes_authorized_web" : "ask_user",
        reason: hermesChat
          ? "GALLEY 未設定或不可用；依需求使用 Hermes 已授權網頁研究。"
          : "GALLEY 與 Hermes 網頁研究都尚未就緒，需要使用者提供來源。",
        fallback: "official_web_directory",
        availability: hermesChat ? "partial" : "unconfigured",
      });
    }
  }

  if (goal.requiresLocalNotes) {
    routes.push({
      id: "local_notes",
      tool: "workspace_search_research",
      reason:
        "倉庫研究筆記可檢索；不得把筆記當成外部驗證或已上線能力。",
      fallback: null,
      availability: "available",
    });
  }

  if (goal.requiresInspiration) {
    routes.push({
      id: "inspiration",
      tool: "workspace_search_inspiration",
      reason: "先讀專案已收藏靈感並分群，不假裝 IG 全站搜尋。",
      fallback: "ask_user",
      availability: "available",
    });
  }

  if (goal.requiresDesign && !goal.requiresImageReview) {
    routes.push({
      id: "visual_spec",
      tool: "workspace_get_visual_concepts",
      reason:
        "先依已確認活動事實編譯 4:5／9:16／A4 三個視覺概念；缺資料標 UNKNOWN，不出圖。",
      fallback: null,
      availability: "available",
    });
    const canvaReady =
      capStatus(canva, "canva.list") === "partial" ||
      capStatus(canva, "canva.create") === "verified";
    routes.push({
      id: "design",
      tool: canvaReady ? "canva_handoff" : "canva_spec_only",
      reason: canvaReady
        ? "Canva 已能讀取設計清單，製作仍需個別驗證。"
        : "Canva 未授權；只整理可交給 Canva 的規格，不假裝已出圖。",
      fallback: "canva_spec_only",
      availability: canvaReady ? "partial" : "unconfigured",
    });
  }

  if (goal.requiresImageAnalysis) {
    const imageReady =
      process.env.HERMES_IMAGE_INPUT === "true" && goal.hasAttachments;
    routes.push({
      id: "image",
      tool: imageReady ? "workspace_read_material" : "ask_user",
      reason: imageReady
        ? "先讀已上傳圖片的真實內容再分析構圖與層級；PDF 未抽取不得當已看圖。"
        : goal.hasAttachments
          ? "圖片已保存，但部署尚未驗證圖片輸入；不得假裝已看圖。"
          : "尚未上傳可分析的圖片；不得依檔名或空訊息假裝已看圖。",
      fallback: imageReady ? "ask_user" : null,
      availability: imageReady ? "available" : "unconfigured",
    });
  }

  if (goal.requiresAudienceEvaluation) {
    routes.push({
      id: "audience",
      tool: "workspace_simulate_audience",
      reason: "受眾評估是規則／模擬，不是真實市場調查。",
      fallback: null,
      availability: "available",
    });
  }

  return routes;
}
