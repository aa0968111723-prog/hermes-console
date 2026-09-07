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
    projectToolId: "framelab",
    projectId: "framelab",
    mcpServerId: "framelab",
    capabilities: ["animation", "timeline", "inbetween", "repair"],
    priority: 1,
    allowedActions: ["read", "draft", "write"],
    enabled: true,
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

/** Animation / FrameLab intent. Checked before generic 影片 → cutos. */
export function isFramelabIntent(intent: string) {
  return (
    /FrameLab|framelab|逐格|時間軸|中間張|影格|RIFE|修壞格|修格|補張|補格|停格|inbetween|keyframe|onion\s*skin|馬桶超人/i.test(
      intent,
    ) || (/動畫/.test(intent) && !/簡報|文宣/.test(intent))
  );
}

export function routeToolsets(intent: string) {
  const selected: string[] = ["research"];
  if (/攤位|空間|3D|booth/i.test(intent)) selected.push("planform", "canva", "tamkang");
  else if (isFramelabIntent(intent)) selected.push("framelab");
  else if (/影片|剪輯|video/i.test(intent)) selected.push("cutos", "canva", "research");
  else if (/海報|文宣|茶會|社團/i.test(intent))
    selected.push("tamkang", "canva", "inspiration", "audience");
  else selected.push("canva");
  const unique = [...new Set(selected)];
  return {
    intent,
    toolsets: unique,
    mappings: PROJECT_CATALOG.filter((item) => unique.includes(item.mcpServerId)),
    note: unique.includes("framelab")
      ? "動畫意圖走 FrameLab MCP（framelab_* / mcp.framelab.*）。GitHub 倉庫網址不是 MCP。"
      : unique.includes("planform")
        ? "planform-iso 未設定 endpoint 時保持 disabled。"
        : "只依任務意圖挑選工具集，不灌入全部 MCP tools。",
  };
}
