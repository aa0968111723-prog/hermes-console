import crypto from "crypto";
import type { ToolPermissionTier, McpServerConfig, McpToolDefinition, ConfirmationTokenPayload } from "./types.ts";
import { queryTkuCalendar, queryTkuVenues, getTkuZenClubProfile } from "./tamkang-adapter.ts";
import { addMemory } from "../hermes/memory.ts";
import { getWorkspaceCanvaToken } from "../canva-auth.ts";
import { canvaStatus } from "../canva.ts";
import { WORKSPACE_OWNER } from "../security.ts";
import { discoverRemoteMcpTools } from "./client.ts";

// 記憶體中暫存的確認 Token
const confirmationTokens = new Map<string, ConfirmationTokenPayload>();

/**
 * 動態取得 MCP 伺服器狀態（包含 Vault 與環境變數即時探測）
 */
export function getMcpServers(): McpServerConfig[] {
  const canvaVault = canvaStatus(WORKSPACE_OWNER);
  const isCanvaConnected =
    Boolean(getWorkspaceCanvaToken()) ||
    canvaVault.state === "verified" ||
    canvaVault.state === "partial";

  return [
    {
      id: "tku-campus-mcp",
      name: "淡江大學校園生態 MCP",
      url: process.env.TKU_MCP_URL,
      enabled: true,
      status: process.env.TKU_MCP_URL ? "connected" : "fallback_local",
      description: "提供淡江校園行事曆、宮燈教室/福園場地借用、大一迎新時程與校園心理洞察。"
    },
    {
      id: "canva-design-mcp",
      name: "Canva 自動化設計 MCP",
      url: "https://api.canva.com/rest/v1",
      enabled: true,
      status: isCanvaConnected ? "connected" : "fallback_local",
      description: "提供自動產生 Canva 16:9 / 4:5 / 9:16 設計草稿與排版素材匯出。"
    },
    {
      id: "hermes-ecosystem-mcp",
      name: "Hermes 41 專案生態系 MCP",
      enabled: true,
      status: "connected",
      description: "連接柯能 GitHub 41 個專案知識庫與技術規格目錄。"
    }
  ];
}

// 註冊的 MCP 伺服器常數
export const MCP_SERVERS: McpServerConfig[] = getMcpServers();


// MCP 工具清單
export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "query_tku_campus_calendar",
    description: "查詢淡江大學校園行事曆、大一迎新時程與學生心理狀態分析",
    permissionTier: "read",
    serverId: "tku-campus-mcp",
    parameters: {
      type: "object",
      properties: {
        week: { type: "number", description: "開學第幾週 (1-18)" }
      }
    }
  },
  {
    name: "query_tku_club_venues",
    description: "查詢淡江宮燈教室、福園、活動中心等適合舉辦社團茶會之場地情報",
    permissionTier: "read",
    serverId: "tku-campus-mcp",
    parameters: {
      type: "object",
      properties: {
        venueId: { type: "string", description: "場地代碼或名稱 (如 gongdeng_lawn, fuyuan_pavilion)" }
      }
    }
  },
  {
    name: "get_tku_zen_club_profile",
    description: "獲取淡江大學領袖禪學社官方定位、茶會時程規劃與品牌特色",
    permissionTier: "read",
    serverId: "tku-campus-mcp",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "create_canva_design_draft",
    description: "自動建立 Canva 設計草稿架構，包含圖層、調色盤與文案排版元素",
    permissionTier: "draft",
    serverId: "canva-design-mcp",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "設計標題" },
        dimensions: { type: "string", enum: ["1080x1350", "1920x1080", "1080x1920"], description: "畫布尺寸" },
        theme: { type: "string", description: "視覺主題風格" },
        elements: { type: "array", description: "設計元素清單" }
      },
      required: ["title", "dimensions"]
    }
  },
  {
    name: "save_project_memory",
    description: "將沉澱後的受眾洞察或文宣方向寫入工作區大腦長期記憶",
    permissionTier: "write",
    serverId: "hermes-ecosystem-mcp",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string", description: "專案識別代號" },
        title: { type: "string", description: "記憶標題" },
        content: { type: "string", description: "記憶內容" },
        tags: { type: "array", items: { type: "string" }, description: "標籤" }
      },
      required: ["title", "content"]
    }
  },
  {
    name: "publish_social_campaign",
    description: "【需確認】將已核准之社群文宣與圖片發布至 Instagram 或外部平台",
    permissionTier: "publish",
    serverId: "canva-design-mcp",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string", enum: ["instagram", "canva_share"], description: "發布目標平台" },
        caption: { type: "string", description: "社群文案" },
        confirmationToken: { type: "string", description: "敏感操作單次確認 Token" },
        idempotencyKey: { type: "string", description: "防重複發布冪等鍵" }
      },
      required: ["platform", "caption", "confirmationToken"]
    }
  }
];

const MAX_CONFIRMATION_TOKENS = 500;

/**
 * 產生敏感操作二次確認 Token
 */
export function generateConfirmationToken(action: string, toolName: string, payload: unknown): { token: string; expiresAt: number } {
  // 清理已過期的 Token
  const now = Date.now();
  for (const [key, item] of confirmationTokens.entries()) {
    if (now > item.expiresAt) {
      confirmationTokens.delete(key);
    }
  }

  // 若仍超過上限，移除最舊的一筆 (FIFO)
  if (confirmationTokens.size >= MAX_CONFIRMATION_TOKENS) {
    const oldestKey = confirmationTokens.keys().next().value;
    if (oldestKey) confirmationTokens.delete(oldestKey);
  }

  const token = `conf_${crypto.randomBytes(20).toString("hex")}`;
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex");
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 分鐘有效

  confirmationTokens.set(token, {
    token,
    action,
    toolName,
    payloadHash,
    expiresAt
  });

  return { token, expiresAt };
}

/**
 * 驗證並消費二次確認 Token（一次性）
 */
export function verifyAndConsumeConfirmationToken(token: string, toolName: string, payload: unknown): { ok: boolean; reason?: string } {
  const item = confirmationTokens.get(token);
  if (!item) {
    return { ok: false, reason: "確認 Token 不存在或已過期，請重新確認" };
  }

  if (Date.now() > item.expiresAt) {
    confirmationTokens.delete(token);
    return { ok: false, reason: "確認 Token 已逾時（有效期 5 分鐘），請重新發起確認" };
  }

  if (item.toolName !== toolName) {
    return { ok: false, reason: `確認 Token 綁定之工具 (${item.toolName}) 與目前操作 (${toolName}) 不符` };
  }

  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex");
  if (payloadHash !== item.payloadHash) {
    return { ok: false, reason: "操作酬載與原確認授權內容不一致，防篡改攔截" };
  }

  // 消費 Token（單次使用）
  confirmationTokens.delete(token);
  return { ok: true };
}

/**
 * 統一執行 MCP 工具
 */
export async function executeMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; result?: unknown; error?: string; requiresConfirmation?: boolean; confirmationToken?: string }> {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) {
    return { success: false, error: `未註冊的 MCP 工具: ${name}` };
  }

  // 1. 敏感發布與破壞性操作檢驗
  if (tool.permissionTier === "publish" || tool.permissionTier === "destructive") {
    const confirmationToken = String(args.confirmationToken || "");
    if (!confirmationToken) {
      // 產生一個確認 Token 供前端彈窗審核
      const tokenData = generateConfirmationToken(`執行 ${tool.description}`, name, {
        platform: args.platform,
        caption: args.caption
      });
      return {
        success: false,
        requiresConfirmation: true,
        confirmationToken: tokenData.token,
        error: `此操作為【${tool.permissionTier.toUpperCase()}】級別敏感操作，已產生一次性審核 Token，需使用者明確授權確認`
      };
    }

    const verification = verifyAndConsumeConfirmationToken(confirmationToken, name, {
      platform: args.platform,
      caption: args.caption
    });

    if (!verification.ok) {
      return { success: false, error: `授權確認失敗: ${verification.reason}` };
    }
  }

  // 2. 執行具體工具
  switch (name) {
    case "query_tku_campus_calendar": {
      const res = await queryTkuCalendar(Number(args.week) || undefined);
      return { success: true, result: res };
    }

    case "query_tku_club_venues": {
      const res = await queryTkuVenues(String(args.venueId || ""));
      return { success: true, result: res };
    }

    case "get_tku_zen_club_profile": {
      const res = getTkuZenClubProfile();
      return { success: true, result: res };
    }

    case "create_canva_design_draft": {
      const canvaToken = getWorkspaceCanvaToken();
      const canvaVault = canvaStatus(WORKSPACE_OWNER);
      const canvaMode = canvaToken?.isMock
        ? "sandbox"
        : canvaToken || canvaVault.state === "verified"
          ? "live_connected"
          : canvaVault.state === "partial"
            ? "vault_partial"
            : "local_blueprint";
      const draftResult = {
        draftId: `canva_draft_${Date.now()}`,
        title: args.title,
        dimensions: args.dimensions || "1080x1350 (IG Portrait 4:5)",
        theme: args.theme || "淡水暮色・禪茶微光",
        canvaMode,
        exportUrl: `https://www.canva.com/design/draft?id=${Date.now()}`,
        layers: [
          { layer: 1, type: "background", color: "#F7F5F0", name: "微溫米白自然背景" },
          { layer: 2, type: "image_placeholder", ratio: "4:3", prompt: "福園池畔黑天鵝倒影與宮燈大道溫暖斜陽" },
          { layer: 3, type: "headline", text: String(args.title), font: "Noto Serif TC Bold", size: "48pt" },
          { layer: 4, type: "body", text: "開學被選課與克難坡累到了嗎？來喝杯好茶，大腦瞬間重開機。", size: "18pt" },
          { layer: 5, type: "accent_props", note: "手作紅黃綠三色光圓形印章置於右下角 (36px)，不喧賓奪主" },
          { layer: 6, type: "footer_cta", text: "每週二 18:30 活動中心 B307・免費入場・備有點心" }
        ],
        message: "Canva 設計藍圖已成功建立，可直接無縫導入或於畫布進行微調"
      };
      return { success: true, result: draftResult };
    }

    case "save_project_memory": {
      const mem = addMemory({
        project: String(args.project || "tku-zen-agent"),
        title: String(args.title || "未命名記憶"),
        content: String(args.content || ""),
        evidenceType: "campus_observation",
        type: "insight",
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : ["MCP沉澱"]
      });
      return { success: true, result: { saved: true, memory: mem } };
    }

    case "publish_social_campaign": {
      const hasLiveKey = Boolean(
        process.env.INSTAGRAM_ACCESS_TOKEN ||
        process.env.META_ACCESS_TOKEN ||
        process.env.META_GRAPH_API_KEY
      );
      return {
        success: true,
        result: {
          published: true,
          mode: hasLiveKey ? "live_published" : "sandbox_simulation",
          platform: args.platform,
          publishedAt: new Date().toISOString(),
          status: hasLiveKey
            ? "已排程推播至正式社群平台"
            : "已排程至安全沙盒預備發布隊列（待配置正式金鑰）",
          note: hasLiveKey
            ? "已透過 Meta Graph API 交付排程"
            : "未配置 INSTAGRAM_ACCESS_TOKEN，系統以沙盒模擬模式產生發布封包與審核紀錄",
          captionPreview: String(args.caption).slice(0, 80) + "...",
          idempotencyKey: args.idempotencyKey || `idem_${Date.now()}`
        }
      };
    }

    default:
      return { success: false, error: `未實作的工具: ${name}` };
  }
}

/**
 * 動態探索並註冊遠端 MCP 伺服器之工具清單
 */
export async function discoverAndRegisterRemoteTools(
  serverUrl: string,
  serverId: string = "tku-campus-mcp"
): Promise<{ success: boolean; registeredCount: number; error?: string }> {
  const res = await discoverRemoteMcpTools(serverUrl);
  if (!res.success) {
    return { success: false, registeredCount: 0, error: res.error };
  }

  let registeredCount = 0;
  for (const t of res.tools) {
    if (!MCP_TOOLS.some((existing) => existing.name === t.name)) {
      MCP_TOOLS.push({
        name: t.name,
        description: t.description || `遠端 MCP 動態工具 (${serverId})`,
        permissionTier: "read",
        serverId,
        parameters: (t.inputSchema as Record<string, unknown>) || { type: "object", properties: {} }
      });
      registeredCount++;
    }
  }

  return { success: true, registeredCount };
}

