import crypto from "crypto";
import type { ToolPermissionTier, McpServerConfig, McpToolDefinition, ConfirmationTokenPayload } from "./types.ts";
import { queryTkuCalendar, queryTkuVenues, getTkuZenClubProfile } from "./tamkang-adapter.ts";
import { addMemory } from "../hermes/memory.ts";
import { getWorkspaceCanvaToken } from "../canva-auth.ts";
import { canvaStatus, exportCanvaDesign } from "../canva.ts";
import { WORKSPACE_OWNER } from "../security.ts";
import { discoverRemoteMcpTools } from "./client.ts";
import { resolveContextDomain } from "../audience-twin/engine.ts";
import { getSocialLogisticsForDomain } from "../creative-workflow/directions.ts";
import { connectCreativeToCanva } from "../creative/canva-workflow.ts";
import { researchInstagramTrends } from "../social/instagram-research.ts";
import { describeMcpSandboxPublish } from "../publish/safe-workflow.ts";
import { ingestUrl, listInspiration } from "../inspiration.ts";
import { resolveInspirationUrl, runInspirationPipeline } from "../inspiration/engine.ts";


// 記憶體中暫存的確認 Token
const confirmationTokens = new Map<string, ConfirmationTokenPayload>();

/**
 * 動態取得 MCP 伺服器狀態（包含 Vault 與環境變數即時探測）
 */
export function getMcpServers(): McpServerConfig[] {
  let canvaVault: { state?: string } = { state: "unconfigured" };
  try {
    canvaVault = canvaStatus(WORKSPACE_OWNER);
  } catch {
    // 容錯防禦：若資料庫處於高並行存取競爭，降級為預設狀態不阻塞模組初始化
  }
  const canvaState = canvaVault.state;
  const canvaStatusValue: McpServerConfig["status"] =
    canvaState === "verified"
      ? "connected"
      : canvaState === "partial" || Boolean(getWorkspaceCanvaToken())
        ? "partial"
        : "unconfigured";

  return [
    {
      id: "tku-campus-mcp",
      name: "淡江大學校園生態 MCP",
      url: process.env.TKU_MCP_URL,
      enabled: Boolean(process.env.TKU_MCP_URL),
      status: process.env.TKU_MCP_URL ? "partial" : "unconfigured",
      description: process.env.TKU_MCP_URL
        ? "已設定 TKU_MCP_URL，尚未完成 initialize／tools/list／安全讀取，不能稱為 connected。"
        : "未設定 TKU_MCP_URL。本機校園筆記不是 MCP。"
    },
    {
      id: "canva-design-mcp",
      name: "Canva 自動化設計 MCP",
      url: "https://api.canva.com/rest/v1",
      enabled: canvaStatusValue !== "unconfigured",
      status: canvaStatusValue,
      description:
        canvaStatusValue === "connected"
          ? "Canva Vault 已驗證。"
          : canvaStatusValue === "partial"
            ? "持有 Canva token 或清單讀取，尚未完成完整 verify。"
            : "未授權 Canva。本地草稿藍圖不是 Canva MCP。"
    },
    {
      id: "hermes-ecosystem-mcp",
      name: "Hermes 專案生態系 MCP",
      enabled: false,
      status: "unconfigured",
      description: "GitHub 專案目錄不是 MCP。需提供 endpoint、transport 與 permission 才可註冊。"
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
    name: "export_canva_design_draft",
    description: "將 Canva 設計或藍圖匯出為高品質 PNG/JPG/PDF 圖片或取得下載連結",
    permissionTier: "draft",
    serverId: "canva-design-mcp",
    parameters: {
      type: "object",
      properties: {
        designId: { type: "string", description: "Canva 設計識別碼 (若已有官方產生之 designId)" },
        draftId: { type: "string", description: "草稿藍圖識別碼" },
        format: { type: "string", enum: ["png", "jpg", "pdf"], description: "匯出格式 (預設 png)" }
      }
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
    name: "research_instagram_trends",
    description: "調研指定校園或大專領域之 Instagram 熱門標籤、最佳發文時段分佈與視覺版型規範",
    permissionTier: "read",
    serverId: "tku-campus-mcp",
    parameters: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          enum: ["tamkang", "ntu", "general"],
          description: "校園或專案領域（淡江、臺大、通用大專）"
        },
        topic: { type: "string", description: "活動主題或社團名稱（如迎新茶會、野餐）" }
      }
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
  },
  {
    name: "inspiration_list",
    description: "列出工作區已收藏的靈感項目清單",
    permissionTier: "read",
    serverId: "hermes-ecosystem-mcp",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "專案代碼 (預設 personal)" }
      }
    }
  },
  {
    name: "inspiration_ingest",
    description: "將公開 HTTPS 網址收藏進 Hermes Console 靈感庫",
    permissionTier: "write",
    serverId: "hermes-ecosystem-mcp",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "公開 HTTPS 網址" },
        projectId: { type: "string", description: "專案代碼 (預設 personal)" },
        caption: { type: "string", description: "備註說明或文案摘要" },
        account: { type: "string", description: "作者或社群帳號" }
      },
      required: ["url"]
    }
  },
  {
    name: "inspiration_search",
    description: "搜尋工作區靈感庫並執行萬象靈感調研管線",
    permissionTier: "read",
    serverId: "hermes-ecosystem-mcp",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "靈感搜尋提示詞" },
        projectId: { type: "string", description: "專案代碼 (預設 personal)" },
        url: { type: "string", description: "可選之參考網址" }
      }
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

      const domain = resolveContextDomain(String(args.title || "") + " " + String(args.theme || ""));
      const logistics = getSocialLogisticsForDomain(domain);

      const defaultLayers = [
        { layer: 1, type: "background", color: "#F7F5F0", name: "微溫米白自然背景" },
        {
          layer: 2,
          type: "image_placeholder",
          ratio: "4:3",
          prompt:
            domain === "ntu"
              ? "椰林大道開闊綠意與醉月湖畔微風斜陽"
              : domain === "general"
              ? "校園綠意草坪散景與溫暖茶席光影"
              : "福園池畔黑天鵝倒影與宮燈大道溫暖斜陽"
        },
        { layer: 3, type: "headline", text: String(args.title), font: "Noto Serif TC Bold", size: "48pt" },
        {
          layer: 4,
          type: "body",
          text:
            domain === "ntu"
              ? "初入公館被選課與椰林迷路累到了嗎？來喝杯好茶，大腦瞬間重開機。"
              : domain === "general"
              ? "開學面對新環境被選課排課累到了嗎？來喝杯好茶，大腦瞬間重開機。"
              : "開學被選課與克難坡累到了嗎？來喝杯好茶，大腦瞬間重開機。",
          size: "18pt"
        },
        { layer: 5, type: "accent_props", note: "手作紅黃綠三色光圓形印章置於右下角 (36px)，不喧賓奪主" },
        { layer: 6, type: "footer_cta", text: logistics.badgeContent }
      ];

      const connected = connectCreativeToCanva({
        title: String(args.title || "未命名草稿"),
        copy: String(args.theme || ""),
        cta: logistics.badgeContent,
        visual: String(args.theme || ""),
        layers: (Array.isArray(args.elements) && args.elements.length > 0
          ? args.elements
          : defaultLayers) as Array<{ layer: number; type: string; content?: string; note?: string }>,
      });
      const draftResult = {
        draftId: `canva_draft_${Date.now()}`,
        title: args.title,
        dimensions: args.dimensions || "1080x1350 (IG Portrait 4:5)",
        theme: args.theme || (domain === "ntu" ? "椰林微風・湖畔茶聚" : domain === "general" ? "校園生活・心靈茶席" : "淡水暮色・禪茶微光"),
        canvaMode: connected.mode === "unconfigured" || connected.mode === "needs_authorization" ? "local_blueprint" : canvaMode,
        created: false,
        liveDesignId: null,
        exportUrl: connected.openUrl,
        layers: Array.isArray(args.elements) && args.elements.length > 0 ? args.elements : defaultLayers,
        message: connected.message
      };
      return { success: true, result: draftResult };
    }

    case "export_canva_design_draft": {
      const designId = String(args.designId || "");
      const draftId = String(args.draftId || `draft_${Date.now()}`);
      const format = (String(args.format || "png").toLowerCase() as "png" | "jpg" | "pdf");
      const canvaVault = canvaStatus(WORKSPACE_OWNER);
      const canvaToken = getWorkspaceCanvaToken();
      const isLive = Boolean(canvaToken && !canvaToken.isMock && canvaVault.state === "verified");

      if (isLive && designId) {
        try {
          const exportResult = await exportCanvaDesign(WORKSPACE_OWNER, { designId, format });
          return {
            success: true,
            result: {
              mode: "live_connected",
              designId,
              format,
              job: exportResult,
              message: "已向 Canva 官方 API 成功提交匯出工作"
            }
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            error: `Canva 官方匯出請求失敗: ${msg}`
          };
        }
      }

      return {
        success: true,
        result: {
          mode: "sandbox_blueprint",
          draftId,
          designId: designId || "blueprint_mock_design_id",
          format,
          jobId: `export_job_mock_${Date.now()}`,
          status: "success",
          exportUrl: `https://www.canva.com/design/export_preview?id=${encodeURIComponent(draftId)}&format=${format}`,
          previewDimensions: "1080x1350",
          message: isLive
            ? "已產生高品質設計草稿匯出預覽"
            : "未連線 Canva 官方付費 API 憑證，系統以高擬真沙盒規格產生 1080x1350 匯出規格與下載連結"
        }
      };
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

    case "research_instagram_trends": {
      const report = researchInstagramTrends({
        domain: typeof args.domain === "string" ? args.domain : undefined,
        topic: typeof args.topic === "string" ? args.topic : undefined
      });
      return { success: true, result: report };
    }

    case "publish_social_campaign": {
      const idempotencyKey = String(args.idempotencyKey || `idem_${Date.now()}`);
      return {
        success: true,
        result: describeMcpSandboxPublish({
          platform: String(args.platform || "instagram"),
          caption: String(args.caption || ""),
          idempotencyKey,
        }),
      };
    }

    case "inspiration_list": {
      const projectId = typeof args.projectId === "string" ? args.projectId : undefined;
      const items = listInspiration(projectId);
      return {
        success: true,
        result: {
          items,
          count: items.length,
          projectId: projectId || "personal",
        },
      };
    }

    case "inspiration_ingest": {
      const url = String(args.url || "");
      if (!url) return { success: false, error: "缺少 url 參數" };
      try {
        const item = resolveInspirationUrl({
          url,
          projectId: typeof args.projectId === "string" ? args.projectId : "personal",
          caption: typeof args.caption === "string" ? args.caption : undefined,
          account: typeof args.account === "string" ? args.account : undefined,
        });

        return {
          success: true,
          result: {
            ingested: true,
            item,
            message: "已成功收藏進工作區靈感庫。",
          },
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `靈感收藏失敗: ${msg}` };
      }
    }

    case "inspiration_search": {
      try {
        const pipeline = runInspirationPipeline({
          prompt: typeof args.prompt === "string" ? args.prompt : "幫我找靈感",
          projectId: typeof args.projectId === "string" ? args.projectId : "personal",
          url: typeof args.url === "string" ? args.url : undefined,
        });
        return { success: true, result: pipeline };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `靈感搜尋失敗: ${msg}` };
      }
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

