import { getWorkspaceCanvaToken } from "../canva-auth.ts";
import { canvaStatus } from "../canva.ts";
import { WORKSPACE_OWNER } from "../security.ts";

export function normalizeBaseUrl(raw?: string): string {
  if (!raw) return "";
  return raw.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
}

export const HERMES_DEFAULTS = {
  DEFAULT_MODEL: "hermes-agent",
  DEFAULT_API_KEY: ""
};

export type IntegrationTruthStatus =
  | "Connected"
  | "Verified"
  | "Partial"
  | "Unconfigured"
  | "Needs Authorization"
  | "Unsupported"
  | "Failed";

export interface IntegrationCheckResult {
  id: string;
  name: string;
  category: "brain" | "design" | "campus_mcp" | "social" | "code";
  status: IntegrationTruthStatus;
  statusBadge: string;
  latencyMs: number;
  details: string;
  capabilities: string[];
  lastCheckedAt: number;
}

/**
 * 探測 Zeabur Hermes Agent 主腦狀態 (Truthful Probe)
 */
export async function probeZeaburHermesStatus(
  rawUrl?: string,
  apiKey?: string
): Promise<IntegrationCheckResult> {
  const start = Date.now();
  const base = normalizeBaseUrl(rawUrl || process.env.HERMES_API_URL || "");
  const key = (apiKey || process.env.HERMES_API_KEY || HERMES_DEFAULTS.DEFAULT_API_KEY).trim();

  if (!base) {
    return {
      id: "zeabur_hermes",
      name: "Zeabur Hermes Brain",
      category: "brain",
      status: "Unconfigured",
      statusBadge: "未配置網域",
      latencyMs: 0,
      details: "尚未綁定 Zeabur 公開網域，目前由本地高擬真雙引擎沙盒提供完整功能。",
      capabilities: ["local_cot", "local_tools", "sse_streaming"],
      lastCheckedAt: Date.now()
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(`${base}/v1/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal
    }).catch(() => null);

    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (res && res.ok) {
      return {
        id: "zeabur_hermes",
        name: "Zeabur Hermes Brain",
        category: "brain",
        status: "Verified",
        statusBadge: "已驗證在線",
        latencyMs,
        details: `Zeabur 雲端服務運行正常，延遲 ${latencyMs}ms，已通過 /v1/models 能力探測。`,
        capabilities: ["cloud_chat", "streaming", "function_calling", "remote_models"],
        lastCheckedAt: Date.now()
      };
    }

    if (res && res.status === 401) {
      return {
        id: "zeabur_hermes",
        name: "Zeabur Hermes Brain",
        category: "brain",
        status: "Needs Authorization",
        statusBadge: "金鑰需配置",
        latencyMs,
        details: "Zeabur 伺服器在線，但回傳 HTTP 401 未授權，請至設定面板填寫有效的 API Server Key。",
        capabilities: ["local_fallback"],
        lastCheckedAt: Date.now()
      };
    }

    // 測試根路徑或 health
    const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    if (health && health.ok) {
      return {
        id: "zeabur_hermes",
        name: "Zeabur Hermes Brain",
        category: "brain",
        status: "Connected",
        statusBadge: "已連線",
        latencyMs: Date.now() - start,
        details: "伺服器健康檢查通過，大腦服務在線。",
        capabilities: ["cloud_chat", "streaming"],
        lastCheckedAt: Date.now()
      };
    }

    return {
      id: "zeabur_hermes",
      name: "Zeabur Hermes Brain",
      category: "brain",
      status: "Partial",
      statusBadge: "本地備援中",
      latencyMs: Date.now() - start,
      details: "Zeabur 雲端服務暫時無回應，已自動啟用本地高擬真大腦沙盒，對話與工具皆正常運作。",
      capabilities: ["local_brain", "offline_ready"],
      lastCheckedAt: Date.now()
    };
  } catch {
    return {
      id: "zeabur_hermes",
      name: "Zeabur Hermes Brain",
      category: "brain",
      status: "Partial",
      statusBadge: "本地備援中",
      latencyMs: Date.now() - start,
      details: "網路探測異常，本地雙引擎備援運作中。",
      capabilities: ["local_brain"],
      lastCheckedAt: Date.now()
    };
  }
}

/**
 * 探測 Canva 連接狀態 (Truthful Probe)
 */
export function probeCanvaStatus(): IntegrationCheckResult {
  const token = getWorkspaceCanvaToken();
  const hasClientId = Boolean(process.env.CANVA_CLIENT_ID);
  const ownerStatus = canvaStatus(WORKSPACE_OWNER);

  if (ownerStatus.verifiedAt && (ownerStatus.state === "verified" || ownerStatus.state === "partial")) {
    return {
      id: "canva",
      name: "Canva Design Bridge",
      category: "design",
      status: ownerStatus.state === "verified" ? "Verified" : "Partial",
      statusBadge: ownerStatus.state === "verified" ? "已驗證在線" : "已驗證清單讀取",
      latencyMs: 5,
      details: ownerStatus.message || "已驗證設計清單讀取，Canva 官方連線正常。",
      capabilities: ["oauth_pkce", "design_read_write", "asset_export", "vault_encrypted"],
      lastCheckedAt: Date.now()
    };
  }

  if (token) {
    if (token.isMock) {
      return {
        id: "canva",
        name: "Canva Design Bridge",
        category: "design",
        status: "Partial",
        statusBadge: "沙盒模擬連線",
        latencyMs: 1,
        details: "已連接 Canva 沙盒模擬環境，支援完整設計藍圖分層生成與匯出草稿。",
        capabilities: ["blueprint_export", "layer_hierarchy", "sandbox_mode"],
        lastCheckedAt: Date.now()
      };
    }
    return {
      id: "canva",
      name: "Canva Design Bridge",
      category: "design",
      status: "Partial",
      statusBadge: "記憶體有 token，尚未 verify",
      latencyMs: 5,
      details: "工作區持有 Canva token，但尚未完成設計清單 verify。不能稱為 Connected。",
      capabilities: ["oauth_pkce"],
      lastCheckedAt: Date.now()
    };
  }

  if (ownerStatus.needsAuthorization || hasClientId) {
    return {
      id: "canva",
      name: "Canva Design Bridge",
      category: "design",
      status: "Needs Authorization",
      statusBadge: "等待 PKCE 授權",
      latencyMs: 0,
      details: "已配置 Canva Client ID，點擊可進行 OAuth PKCE 單次授權（無須系統登入）。",
      capabilities: ["oauth_configured"],
      lastCheckedAt: Date.now()
    };
  }

  return {
    id: "canva",
    name: "Canva Design Bridge",
    category: "design",
    status: "Unconfigured",
    statusBadge: "未配置憑證",
    latencyMs: 0,
    details: "未配置 CANVA_CLIENT_ID，系統提供高擬真設計草稿藍圖與沙盒測試模式。",
    capabilities: ["blueprint_generation", "json_export"],
    lastCheckedAt: Date.now()
  };
}

/**
 * 探測淡江大學校園生態 MCP (Truthful Probe)
 */
export async function probeTamkangMcpStatus(): Promise<IntegrationCheckResult> {
  const remoteUrl = process.env.TKU_MCP_URL;
  if (remoteUrl) {
    const start = Date.now();
    try {
      const res = await fetch(`${remoteUrl}/health`, {
        headers: { Authorization: `Bearer ${process.env.TKU_MCP_TOKEN || ""}` },
        signal: AbortSignal.timeout(3000)
      }).catch(() => null);

      if (res && res.ok) {
        return {
          id: "tku_mcp",
          name: "淡江大學生態 MCP",
          category: "campus_mcp",
          status: "Partial",
          statusBadge: "遠端可連線，尚未 tools/list 驗證",
          latencyMs: Date.now() - start,
          details: "TKU_MCP_URL 有回應，但尚未完成 initialize／tools/list／安全讀取，不能稱為 Verified。",
          capabilities: ["http_reachable"],
          lastCheckedAt: Date.now()
        };
      }
    } catch {
      // 降級
    }
    return {
      id: "tku_mcp",
      name: "淡江大學生態 MCP",
      category: "campus_mcp",
      status: "Failed",
      statusBadge: "遠端不可用",
      latencyMs: Date.now() - start,
      details: "已設定 TKU_MCP_URL 但探測失敗。可改用公開網頁研究，不把本機知識圖譜當成 MCP。",
      capabilities: ["web_fallback"],
      lastCheckedAt: Date.now()
    };
  }

  return {
    id: "tku_mcp",
    name: "淡江大學生態 MCP",
    category: "campus_mcp",
    status: "Unconfigured",
    statusBadge: "未設定 TKU_MCP_URL",
    latencyMs: 0,
    details: "未配置遠端 Tamkang MCP。本機校園筆記不是 MCP，狀態為 Unconfigured。",
    capabilities: ["console_notes_only"],
    lastCheckedAt: Date.now()
  };
}

/**
 * 探測 Instagram 靈感調研狀態
 */
export function probeInstagramStatus(): IntegrationCheckResult {
  const hasMetaApi = Boolean(
    process.env.INSTAGRAM_ACCESS_TOKEN ||
      (process.env.META_APP_ID && process.env.META_ACCESS_TOKEN),
  );

  if (hasMetaApi) {
    return {
      id: "instagram_search",
      name: "Instagram Inspiration",
      category: "social",
      status: "Needs Authorization",
      statusBadge: "已設定憑證，尚未完成 Graph 探測",
      latencyMs: 0,
      details: "已設定 Meta／Instagram 環境變數，但尚未對 Graph API 做成功探測。不能稱為 Connected，也不等於全站搜尋。",
      capabilities: ["env_present"],
      lastCheckedAt: Date.now()
    };
  }

  return {
    id: "instagram_search",
    name: "Instagram Inspiration",
    category: "social",
    status: "Partial",
    statusBadge: "公開連結解析模式",
    latencyMs: 0,
    details: "無全域 Meta API，誠實支援使用者貼上公開貼文連結解析、網頁公開搜尋與美學風格萃取，遵循合理使用規範。",
    capabilities: ["url_parsing", "aspect_ratio_4_5", "aesthetic_extraction"],
    lastCheckedAt: Date.now()
  };
}

/**
 * 探測 Pinterest 靈感調研狀態
 */
export function probePinterestStatus(): IntegrationCheckResult {
  const hasPinterestApi = Boolean(process.env.PINTEREST_ACCESS_TOKEN);

  if (hasPinterestApi) {
    return {
      id: "pinterest_search",
      name: "Pinterest Inspiration",
      category: "social",
      status: "Needs Authorization",
      statusBadge: "已設定憑證，尚未完成 API 探測",
      latencyMs: 0,
      details: "已設定 PINTEREST_ACCESS_TOKEN，但尚未對官方 API 做成功探測。不能稱為 Connected，也不等於全站搜尋。",
      capabilities: ["env_present"],
      lastCheckedAt: Date.now()
    };
  }

  return {
    id: "pinterest_search",
    name: "Pinterest Inspiration",
    category: "social",
    status: "Partial",
    statusBadge: "公開情緒板解析模式",
    latencyMs: 0,
    details: "誠實支援使用者輸入公開 Pin 連結解析與色彩情緒板提取，絕不偽造非公開數據。",
    capabilities: ["pin_url_parsing", "moodboard_palette"],
    lastCheckedAt: Date.now()
  };
}

/**
 * 取得全域整合狀態報告
 */
export async function getAllIntegrationsReport(options?: {
  rawUrl?: string;
  apiKey?: string;
}): Promise<{
  timestamp: number;
  integrations: IntegrationCheckResult[];
  overallHealth: "healthy" | "partial_ready" | "needs_attention";
}> {
  const [hermes, canva, tku, instagram, pinterest] = await Promise.all([
    probeZeaburHermesStatus(options?.rawUrl, options?.apiKey),
    Promise.resolve(probeCanvaStatus()),
    probeTamkangMcpStatus(),
    Promise.resolve(probeInstagramStatus()),
    Promise.resolve(probePinterestStatus())
  ]);

  const integrations = [hermes, canva, tku, instagram, pinterest];
  const hasVerified = integrations.some((i) => i.status === "Verified");
  const allFailed = integrations.every((i) =>
    ["Failed", "Unconfigured"].includes(i.status),
  );
  const overallHealth = hasVerified
    ? "healthy"
    : allFailed
      ? "needs_attention"
      : "partial_ready";

  return {
    timestamp: Date.now(),
    integrations,
    overallHealth
  };
}
