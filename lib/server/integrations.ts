import type { Health, Task, IntegrationState } from "../contracts";
import { list } from "./store";
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
      detail: "貼文連結與參考圖可保存；不承諾全站搜尋。正式發佈未啟用。",
      requirements: [
        "Hermes 中的 Instagram 工具／MCP",
        "專業帳號與所需 OAuth 範圍",
        "獨立發佈確認與去重驗證",
      ],
    },
    {
      id: "tku",
      name: "淡江 MCP",
      pattern: /tku|tamkang|tronclass/i,
      detail: "尚未確認指定倉庫、工具範圍與授權；課務資料不等於全部校園資訊。",
      requirements: ["MCP 倉庫與實際服務端點", "公開／私人資料範圍與授權"],
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
      detail:
        "支援 HTTPS Pin／看板連結收藏；官方搜尋能力需另行驗證。參考素材不保證可商用。",
      requirements: ["Hermes Pinterest 工具／MCP", "官方帳號授權及搜尋權限"],
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
  return definitions.map((d) => {
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
}
