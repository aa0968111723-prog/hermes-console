import { tamkangConfigured } from "../tamkang.ts";

export interface ProjectToolMapping {
  projectToolId: string;
  projectId: string;
  mcpServerId: string;
  capabilities: string[];
  priority: number;
  allowedActions: Array<"read" | "draft" | "write">;
  enabled: boolean;
  status?: "ready" | "disabled" | "fallback_available";
}

export const PROJECT_CATALOG: ProjectToolMapping[] = [
  {
    projectToolId: "planform-iso",
    projectId: "planform",
    mcpServerId: "planform",
    capabilities: ["layout", "space", "booth", "3d"],
    priority: 2,
    allowedActions: ["read", "draft"],
    enabled: false,
  },
  {
    projectToolId: "cutos",
    projectId: "cutos",
    mcpServerId: "cutos",
    capabilities: ["video", "editing"],
    priority: 2,
    allowedActions: ["read", "draft"],
    enabled: false,
  },
  {
    projectToolId: "aios",
    projectId: "aios",
    mcpServerId: "aios",
    capabilities: ["creative", "project"],
    priority: 3,
    allowedActions: ["read", "draft"],
    enabled: false,
  },
  {
    projectToolId: "tku-campus",
    projectId: "tamkang",
    mcpServerId: "tamkang",
    capabilities: ["campus_calendar", "venues", "club_profile", "campus_search"],
    priority: 1,
    allowedActions: ["read"],
    enabled: false,
  },
  {
    projectToolId: "canva-bridge",
    projectId: "canva",
    mcpServerId: "canva",
    capabilities: ["design_blueprint", "template_dataset", "export"],
    priority: 1,
    allowedActions: ["read", "draft"],
    enabled: true,
  },
];

/**
 * 動態評估專案 MCP 目錄的即時啟用與備援狀態
 */
export function getDynamicProjectCatalog(): ProjectToolMapping[] {
  const tkuConfigured = tamkangConfigured();
  const planformConfigured = Boolean(process.env.PLANFORM_MCP_URL);
  const cutosConfigured = Boolean(process.env.CUTOS_MCP_URL);
  const aiosConfigured = Boolean(process.env.AIOS_MCP_URL);

  return PROJECT_CATALOG.map((item) => {
    let enabled = item.enabled;
    let status: "ready" | "disabled" | "fallback_available" = "disabled";

    if (item.mcpServerId === "planform") {
      enabled = planformConfigured;
      status = enabled ? "ready" : "disabled";
    } else if (item.mcpServerId === "cutos") {
      enabled = cutosConfigured;
      status = enabled ? "ready" : "disabled";
    } else if (item.mcpServerId === "aios") {
      enabled = aiosConfigured;
      status = enabled ? "ready" : "disabled";
    } else if (item.mcpServerId === "tamkang") {
      enabled = tkuConfigured;
      status = enabled ? "ready" : "fallback_available";
    } else if (item.mcpServerId === "canva") {
      enabled = true;
      status = "ready";
    }

    return {
      ...item,
      enabled,
      status,
    };
  });
}

export function routeToolsets(intent: string, projectId?: string) {
  const selected: string[] = ["research"];
  if (/攤位|空間|3D|booth/i.test(intent)) selected.push("planform", "canva", "tamkang");
  else if (/影片|剪輯|video/i.test(intent)) selected.push("cutos", "canva", "research");
  else if (/海報|文宣|茶會|社團/i.test(intent))
    selected.push("tamkang", "canva", "inspiration", "audience");
  else selected.push("canva");
  const unique = [...new Set(selected)];

  const catalog = getDynamicProjectCatalog();
  const mappings = catalog.filter((item) => {
    if (!unique.includes(item.mcpServerId)) return false;
    if (projectId && item.projectId && item.projectId !== projectId) return false;
    return true;
  });

  return {
    intent,
    toolsets: unique,
    mappings,
    note: unique.includes("planform")
      ? "planform-iso 未設定 endpoint 時保持 disabled。"
      : "只依任務意圖挑選工具集，不灌入全部 MCP tools。",
    intentClassification: /攤位|空間|3D|booth/i.test(intent)
      ? "space_and_booth"
      : /影片|剪輯|video/i.test(intent)
      ? "video_production"
      : /海報|文宣|茶會|社團/i.test(intent)
      ? "creative_campaign"
      : "general_design",
  };
}
