import type { Health, Task, IntegrationState } from "../contracts";
import { list } from "./store";
import { canvaStatus } from "./canva";
import { instagramPublishStatus } from "./publish";
import { pinterestResearchLimits, instagramResearchLimits } from "./inspiration";
import { tamkangStatus } from "./tamkang";
import { xunheStatus } from "./xunhe";
import { lumenStatus } from "./lumen";
import { framelabStatus } from "./framelab";
import { seedRegistry } from "./mcp-registry";
export interface Integration {
  id: string;
  name: string;
  state: IntegrationState;
  detail: string;
  verifiedAt: string | null;
  tools: string[];
  evidence: string | null;
  requirements: string[];
}
export function integrations(owner: string, h: Health): Integration[] {
  const definitions = [
    {
      id: "instagram",
      name: "Instagram",
      pattern: /instagram|(^|_)ig_/i,
      detail: instagramResearchLimits().notice,
      requirements: [
        "使用者貼 IG URL、網頁索引或已授權 Meta API",
        "正式發佈需 OAuth、publish 權限與一次性確認",
      ],
    },
    {
      id: "tku",
      name: "淡江 MCP",
      pattern: /tku|tamkang|tronclass|campus|tamsui/i,
      detail: tamkangStatus().detail,
      requirements: ["連線設定或 TKU_MCP_URL／TKU_MCP_TOKEN", "實際 tools/list 驗證"],
    },
    {
      id: "xunhe",
      name: "訊核即時情報",
      pattern: /xunhe|訊核|intel/i,
      detail: "Hermes 經 MCP 呼叫訊核研究、任務與報告工具。GitHub 倉庫網址不是 MCP。",
      requirements: ["XUNHE_MCP_URL（訊核 /mcp）", "可選 XUNHE_MCP_TOKEN", "initialize／tools/list 驗證"],
    },
    {
      id: "lumen",
      name: "Lumen 創作台",
      pattern: /lumen|創作台|海報|文宣|招新|茶會/,
      detail: "文宣意圖走 lumen_*／mcp.lumen.*；選定方向留給使用者。GitHub 倉庫網址不是 MCP。",
      requirements: ["連線設定或 LUMEN_MCP_URL／LUMEN_MCP_TOKEN", "initialize／tools/list 驗證"],
    },
    {
      id: "framelab",
      name: "FrameLab",
      pattern: /framelab|frame.?lab|animation|timeline|inbetween/i,
      detail: "Hermes 經 MCP 呼叫 FrameLab 動畫工具。GitHub 倉庫網址不是 MCP。",
      requirements: ["FRAMELAB_MCP_URL（FrameLab /api/mcp）", "FRAMELAB_MCP_TOKEN", "initialize／tools/list 驗證"],
    },
    {
      id: "canva",
      name: "Canva",
      pattern: /canva/i,
      detail: "需由 Hermes 已授權的設計工具製作；文件查詢不代表可操作設計。",
      requirements: [
        "Hermes Canva 設計 MCP 或 Connect OAuth",
        "查找／建立／編輯／匯出各項操作的實際驗證",
      ],
    },
    {
      id: "projects",
      name: "專案工具",
      pattern: /project|github/i,
      detail:
        "工作區專案由實際建立的資料計數。GitHub 連結不代表具備專案控制權。",
      requirements: [
        "各專案的 MCP／API 端點與最小權限",
        "實際操作的輸入輸出契約",
      ],
    },
    {
      id: "pinterest",
      name: "Pinterest",
      pattern: /pinterest/i,
      detail: pinterestResearchLimits().notice,
      requirements: ["Pin／看板 HTTPS 連結", "Pinterest API 授權（可選）"],
    },
    {
      id: "creative",
      name: "網宣創作流程",
      pattern: /web_search|web_extract|canva/i,
      detail:
        "對話可接續需求核對、參考、三個方向與草稿；每一步依 Hermes 真實回應保存。",
      requirements: [
        "可執行的 Hermes Agent",
        "搜尋來源與 Canva 製作工具的真實端到端案例",
      ],
    },
  ];
  const events = list<Task>("task", owner).flatMap((t) => t.events);
  const registry = seedRegistry();
  const extras: Integration[] = [
    {
      id: "hermes",
      name: "Hermes",
      state: h.status,
      detail: h.message,
      verifiedAt: h.checkedAt,
      tools: h.toolsets.flatMap((t) => t.tools || []),
      evidence: h.credential === "valid" ? "models" : null,
      requirements: ["連線設定或 HERMES_API_URL／HERMES_API_KEY"],
    },
    {
      id: "workspace-mcp",
      name: "Workspace MCP",
      state: (registry.find((i) => i.id === "workspace")?.status ===
      "unconfigured"
        ? "unconfigured"
        : "partial") as IntegrationState,
      detail: "Console 自身 MCP；成功連線不代表已 verified。",
      verifiedAt: null,
      tools: [],
      evidence: null,
      requirements: ["MCP_BRIDGE_TOKEN"],
    },
  ];
  const mapped: Integration[] = definitions.map((d) => {
    const matching = h.toolsets.filter(
      (t) =>
        d.pattern.test(t.name) ||
        (t.tools || []).some((n) => d.pattern.test(n)),
    );
    const tools = matching.flatMap((t) => t.tools || []);
    const evidence = events.find(
      (e) =>
        !!e.toolName &&
        tools.includes(e.toolName) &&
        ["tool.completed", "completed"].includes(e.status),
    );
    // Individual tool evidence is partial integration coverage, not blanket availability.
    return {
      id: d.id,
      name: d.name,
      state: evidence
        ? "partial"
        : matching.some((t) => t.configured === false)
          ? "awaiting_authorization"
          : matching.length
            ? "partial"
            : "unconfigured",
      detail: d.detail,
      verifiedAt: evidence?.endedAt || null,
      tools,
      evidence: evidence
        ? "工具執行事件 " + evidence.id
        : matching.length
          ? "Hermes 工具清單中已宣告，尚未逐項執行驗證。"
          : null,
      requirements: d.requirements,
    } satisfies Integration;
  });
  const tku = tamkangStatus();
  const ig = instagramPublishStatus();
  const canva = canvaStatus(owner);
  for (const item of mapped) {
    if (item.id === "tku") {
      item.state = tku.state as IntegrationState;
      item.detail = tku.detail;
    }
    if (item.id === "xunhe") {
      const xunhe = xunheStatus();
      item.state = xunhe.state as IntegrationState;
      item.detail = xunhe.detail;
    }
    if (item.id === "lumen") {
      const lumen = lumenStatus();
      item.state = lumen.state as IntegrationState;
      item.detail = lumen.detail;
    }
    if (item.id === "framelab") {
      const framelab = framelabStatus();
      item.state = framelab.state as IntegrationState;
      item.detail = framelab.detail;
    }
    if (item.id === "instagram") {
      item.state = ig.configured ? "awaiting_authorization" : "unconfigured";
      item.detail = ig.message;
    }
    if (item.id === "canva") {
      item.state = canva.state as IntegrationState;
      item.detail = canva.needsAuthorization
        ? "Needs Canva Authorization"
        : canva.message;
      item.verifiedAt = canva.verifiedAt;
    }
  }
  return extras.concat(mapped);
}
