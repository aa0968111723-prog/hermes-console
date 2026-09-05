export interface ProjectToolMapping {
  projectToolId: string;
  projectId: string;
  mcpServerId: string;
  capabilities: string[];
  priority: number;
  allowedActions: Array<"read" | "draft" | "write">;
  enabled: boolean;
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
];

export function routeToolsets(intent: string, projectId?: string) {
  const selected: string[] = ["research"];
  if (/攤位|空間|3D|booth/i.test(intent)) selected.push("planform", "canva", "tamkang");
  else if (/影片|剪輯|video/i.test(intent)) selected.push("cutos", "canva", "research");
  else if (/海報|文宣|茶會|社團/i.test(intent))
    selected.push("tamkang", "canva", "inspiration", "audience");
  else selected.push("canva");
  const unique = [...new Set(selected)];
  const mappings = PROJECT_CATALOG.filter((item) => {
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
  };
}
