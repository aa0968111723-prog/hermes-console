import type { IntegrationCertification } from "../certification/types";
import type { StructuredGoal } from "../../contracts";

export type RoutedTool = {
  id: string;
  tool: string;
  reason: string;
  fallback: string | null;
};

function capStatus(cert: IntegrationCertification | undefined, id: string) {
  return cert?.capabilities.find((item) => item.id === id)?.status;
}

export function routeTools(
  goal: StructuredGoal,
  certifications: IntegrationCertification[],
): RoutedTool[] {
  const tamkang = certifications.find((item) => item.id === "tamkang");
  const hermes = certifications.find((item) => item.id === "hermes");
  const canva = certifications.find((item) => item.id === "canva");
  const routes: RoutedTool[] = [];
  const hermesChat =
    capStatus(hermes, "hermes.chat") === "verified" ||
    capStatus(hermes, "hermes.api") === "reachable";

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

  if (goal.requiresInspiration) {
    routes.push({
      id: "inspiration",
      tool: "project_inspiration_then_web",
      reason: "先讀專案已收藏靈感，再請 Hermes 使用已授權搜尋；不假裝 IG 全站搜尋。",
      fallback: "ask_user",
    });
  }

  if (goal.requiresDesign) {
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
