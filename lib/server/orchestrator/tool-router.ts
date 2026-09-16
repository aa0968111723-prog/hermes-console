import type { IntegrationCertification } from "../certification/types";
import type { IntegrationState, StructuredGoal } from "../../contracts";
import { needsZenclubKnowledge } from "../zenclub";
import { isFramelabIntent, isLumenIntent } from "../projects/router";
import { liveGalleyStatus } from "../galley";
import { lumenStatus } from "../lumen";
import { framelabStatus } from "../framelab";
import { planformStatus } from "../planform";
import { xunheStatus } from "../xunhe";

export type RoutedTool = {
  id: string;
  tool: string;
  reason: string;
  fallback: string | null;
};

export type McpAvailability = {
  galley?: IntegrationState;
  lumen?: IntegrationState;
  framelab?: IntegrationState;
  planform?: IntegrationState;
  xunhe?: IntegrationState;
};

function capStatus(cert: IntegrationCertification | undefined, id: string) {
  return cert?.capabilities.find((item) => item.id === id)?.status;
}

function usable(state?: IntegrationState) {
  return state === "partial" || state === "available";
}

export function liveMcpAvailability(): McpAvailability {
  return {
    galley: liveGalleyStatus().state as IntegrationState,
    lumen: lumenStatus().state as IntegrationState,
    framelab: framelabStatus().state as IntegrationState,
    planform: planformStatus().state as IntegrationState,
    xunhe: xunheStatus().state as IntegrationState,
  };
}

export function routeTools(
  goal: StructuredGoal,
  certifications: IntegrationCertification[],
  availability: McpAvailability = liveMcpAvailability(),
): RoutedTool[] {
  const tamkang = certifications.find((item) => item.id === "tamkang");
  const hermes = certifications.find((item) => item.id === "hermes");
  const canva = certifications.find((item) => item.id === "canva");
  const routes: RoutedTool[] = [];
  const hermesChat =
    capStatus(hermes, "hermes.chat") === "verified" ||
    capStatus(hermes, "hermes.api") === "reachable";
  const webFallback = hermesChat ? "hermes_authorized_web" : "ask_user";

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
  } else if (goal.requiresResearch) {
    if (usable(availability.galley)) {
      routes.push({
        id: "research",
        tool: "galley_research",
        reason: "來源優先研究走已列出的 GALLEY；沒有外部 evidence 不得用記憶填空。",
        fallback: webFallback,
      });
    } else if (usable(availability.xunhe)) {
      routes.push({
        id: "research",
        tool: "xunhe_research",
        reason: "GALLEY 未連線時改用已列出的訊核情報；仍須真實來源。",
        fallback: webFallback,
      });
    } else {
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

  if (
    usable(availability.galley) &&
    (goal.requiresInspiration || goal.requiresTamkang) &&
    !routes.some((item) => item.tool === "galley_research")
  ) {
    routes.push({
      id: "galley",
      tool: "galley_research",
      reason: "靈感與校園題先走 GALLEY 來源優先研究，再讀專案收藏。",
      fallback: webFallback,
    });
  }

  if (goal.requiresImageAnalysis) {
    const imageReady = process.env.HERMES_IMAGE_INPUT === "true";
    routes.push({
      id: "image",
      tool: imageReady ? "workspace_read_material" : "ask_user",
      reason: imageReady
        ? "先讀附件圖片再分析構圖與層級。"
        : "圖片已保存，但還沒驗證看圖，不能假裝已看圖。",
      fallback: imageReady ? null : "describe_without_pixels",
    });
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

  if (isLumenIntent(goal.goal) && usable(availability.lumen)) {
    routes.push({
      id: "lumen",
      tool: "lumen_utter",
      reason: "文宣意圖由 Hermes 呼叫已連線的創作台，不叫使用者自己選 Lumen。",
      fallback: "canva_spec_only",
    });
  }

  if (isFramelabIntent(goal.goal) && usable(availability.framelab)) {
    routes.push({
      id: "framelab",
      tool: "framelab_list_projects",
      reason: "動畫／中間張由 Hermes 呼叫已連線的 FrameLab，不叫使用者自己選工具。",
      fallback: "ask_user",
    });
  }

  if (
    /攤位|場佈|教室排座|門口淨空|booth/i.test(goal.goal) &&
    usable(availability.planform)
  ) {
    routes.push({
      id: "planform",
      tool: "planform_run_agent",
      reason: "場佈意圖由 Hermes 呼叫已連線的 Planform；草稿需確認才套用。",
      fallback: "ask_user",
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
