import type { IntegrationCertification } from "../certification/types";
import type { StructuredGoal } from "../../contracts";
import { needsZenclubKnowledge } from "../zenclub";

export type RoutedTool = {
  id: string;
  tool: string;
  reason: string;
  fallback: string | null;
};

export type RouterMcpHint = {
  status?: string;
};

function mcpUsable(status?: string) {
  return status === "partial" || status === "verified" || status === "connected";
}

function capStatus(cert: IntegrationCertification | undefined, id: string) {
  return cert?.capabilities.find((item) => item.id === id)?.status;
}

export function routeTools(
  goal: StructuredGoal,
  certifications: IntegrationCertification[],
  mcp: { galley?: RouterMcpHint; lumen?: RouterMcpHint } = {},
): RoutedTool[] {
  const tamkang = certifications.find((item) => item.id === "tamkang");
  const hermes = certifications.find((item) => item.id === "hermes");
  const canva = certifications.find((item) => item.id === "canva");
  const routes: RoutedTool[] = [];
  const hermesChat =
    capStatus(hermes, "hermes.chat") === "verified" ||
    capStatus(hermes, "hermes.api") === "reachable";

  if (needsZenclubKnowledge(goal.goal)) {
    routes.push({
      id: "club_knowledge",
      tool: "zenclub_drive_index",
      reason:
        "社團內部事實優先查禪學社 Drive 知識索引，不得用 IG 或合理推測補日期地點。",
      fallback: null,
    });
  }

  if (goal.requiresTamkang) {
    const reachable =
      capStatus(tamkang, "tamkang.reachable") === "reachable" ||
      capStatus(tamkang, "tamkang.tools") === "partial" ||
      capStatus(tamkang, "tamkang.tools") === "verified";
    if (reachable) {
      routes.push({
        id: "campus",
        tool: "tamkang_mcp",
        reason: "淡江資料優先使用已列出的 Tamkang MCP。",
        fallback: "hermes_authorized_web",
      });
    } else if (hermesChat) {
      routes.push({
        id: "campus",
        tool: "hermes_authorized_web",
        reason: "淡江 MCP 目前不可用，改用 Hermes 已授權網頁來源。",
        fallback: "official_web_directory",
      });
    } else {
      routes.push({
        id: "campus",
        tool: "ask_user",
        reason: "淡江 MCP 與 Hermes 網頁研究都尚未驗證，需要使用者提供來源或稍後再試。",
        fallback: null,
      });
    }
  }
  if (goal.requiresResearch) {
    if (mcpUsable(mcp.galley?.status)) {
      routes.push({
        id: "galley",
        tool: "galley_research",
        reason:
          "GALLEY 已列出或通過安全讀取，用來做來源優先研究。沒有來源不得改用記憶填空。",
        fallback: hermesChat ? "hermes_authorized_web" : "ask_user",
      });
    } else if (!goal.requiresTamkang) {
      routes.push({
        id: "research",
        tool: hermesChat ? "hermes_authorized_web" : "ask_user",
        reason: hermesChat
          ? "依需求使用 Hermes 已授權網頁研究。"
          : "Hermes 網頁研究尚未就緒，需要使用者提供來源。",
        fallback: "official_web_directory",
      });
    }
  }

  if (goal.requiresImageRead) {
    routes.push({
      id: "image_read",
      tool: "workspace_read_material",
      reason: "必須先讀已上傳素材的真實內容，不能只看檔名。",
      fallback: null,
    });
  }

  if (goal.requiresInspiration) {
    routes.push({
      id: "inspiration",
      tool: "workspace_search_inspiration",
      reason:
        "先用 workspace_search_inspiration 讀已收藏參考與視覺模式；不假裝 IG 全站搜尋。",
      fallback: "ask_user",
    });
  }

  if (goal.requiresLumen && mcpUsable(mcp.lumen?.status)) {
    routes.push({
      id: "lumen",
      tool: "lumen_utter",
      reason:
        "Lumen 已列出或通過安全讀取，文宣走創作台畫板。沒有工具不得假裝已開畫板。",
      fallback: goal.requiresDesign ? "canva_spec_only" : "ask_user",
    });
  }

  if (goal.requiresDesign) {
    routes.push({
      id: "visual_spec",
      tool: "workspace_get_visual_concepts",
      reason:
        "先依已確認活動事實編譯 4:5／9:16／A4 三個視覺概念；缺資料標 UNKNOWN，不出圖。",
      fallback: null,
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
    });
  }

  if (goal.requiresAudienceEvaluation) {
    routes.push({
      id: "audience",
      tool: "audience_simulation",
      reason: "受眾評估是規則／模擬，不是真實市場調查。",
      fallback: null,
    });
  }

  return routes;
}
