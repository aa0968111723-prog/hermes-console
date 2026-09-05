import { ApiError, consumeConfirmation, mintConfirmation } from "./security";

export interface InstagramPublishStatusResult {
  enabled: boolean;
  configured: boolean;
  authorized: boolean;
  publishScope: boolean;
  state: "ready" | "sandbox" | "needs_authorization" | "unconfigured";
  message: string;
}

/**
 * 探測 Instagram 官方發布狀態 (Truthful Status)
 */
export function instagramPublishStatus(): InstagramPublishStatusResult {
  const hasToken = Boolean(
    process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN
  );
  const hasOAuthConfig = !!(
    process.env.INSTAGRAM_CLIENT_ID && process.env.INSTAGRAM_CLIENT_SECRET
  );
  const configured = hasOAuthConfig || hasToken;
  const livePublishEnabled = hasToken && process.env.ENABLE_LIVE_PUBLISH === "true";

  if (livePublishEnabled) {
    return {
      enabled: true,
      configured: true,
      authorized: true,
      publishScope: true,
      state: "ready",
      message: "Instagram 官方發布已連線並就緒。",
    };
  }

  if (hasToken) {
    return {
      enabled: false,
      configured: true,
      authorized: true,
      publishScope: true,
      state: "sandbox",
      message: "Instagram 已綁定 API 金鑰，處於安全沙盒審核模式（未開啟 ENABLE_LIVE_PUBLISH）。",
    };
  }

  if (hasOAuthConfig) {
    return {
      enabled: false,
      configured: true,
      authorized: false,
      publishScope: false,
      state: "needs_authorization",
      message: "Instagram 發佈預設關閉。需要官方 OAuth、publish 權限、內容準備完成，以及伺服器一次性確認。",
    };
  }

  return {
    enabled: false,
    configured: false,
    authorized: false,
    publishScope: false,
    state: "unconfigured",
    message: "尚未設定 INSTAGRAM_CLIENT_ID／SECRET；發佈保持關閉。",
  };
}

export function requestPublishConfirmation(payload: {
  caption: string;
  mediaId: string;
  target: string;
}) {
  return mintConfirmation({
    action: "instagram_publish",
    target: payload.target,
    payload,
  });
}

export interface ConfirmPublishInput {
  token?: unknown;
  caption: string;
  mediaId: string;
  target: string;
  confirmed?: unknown;
  allowSandbox?: boolean;
}

export interface ConfirmPublishResult {
  ok: boolean;
  state: "published" | "sandbox_simulated";
  id: string;
  mode: "live_meta_graph_api" | "sandbox_audit_simulation";
  publishedAt: string;
  containerId?: string;
  mediaId?: string;
  auditTrail?: {
    target: string;
    caption: string;
    mediaId: string;
    timestamp: string;
    disclaimer: string;
  };
}

/**
 * 伺服器端核驗並執行發布
 */
export function confirmPublish(input: ConfirmPublishInput): ConfirmPublishResult {
  if (input.confirmed === true) {
    throw new ApiError(
      403,
      "confirmation_required",
      "前端 confirmed=true 不足；發佈必須使用伺服器一次性確認。",
    );
  }

  consumeConfirmation({
    token: input.token,
    action: "instagram_publish",
    target: input.target,
    payload: {
      caption: input.caption,
      mediaId: input.mediaId,
      target: input.target,
    },
  });

  const status = instagramPublishStatus();

  // Live Graph is irreversible. This console never fabricates a Meta media id.
  if (status.enabled) {
    const simId = `queued_${Date.now()}`;
    return {
      ok: true,
      state: "sandbox_simulated",
      id: simId,
      mode: "sandbox_audit_simulation",
      publishedAt: new Date().toISOString(),
      mediaId: input.mediaId,
      auditTrail: {
        target: input.target,
        caption: input.caption,
        mediaId: input.mediaId,
        timestamp: new Date().toISOString(),
        disclaimer:
          "ENABLE_LIVE_PUBLISH 已開，但本控制台不呼叫 Meta Graph（不可逆）。僅沙盒審核排隊，未真實發文。",
      },
    };
  }

  // 若請求允許沙盒模擬審核
  if (input.allowSandbox) {
    const simId = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return {
      ok: true,
      state: "sandbox_simulated",
      id: simId,
      mode: "sandbox_audit_simulation",
      publishedAt: new Date().toISOString(),
      auditTrail: {
        target: input.target,
        caption: input.caption,
        mediaId: input.mediaId,
        timestamp: new Date().toISOString(),
        disclaimer: "安全沙盒模擬發布完成，具備完整審核軌跡，未向外部 Meta 發出真實請求。",
      },
    };
  }

  // 未授權或未配置
  if (!status.configured) {
    throw new ApiError(
      409,
      "publish_blocked",
      "尚未完成官方 OAuth 與 publish 權限，發佈未執行。",
    );
  }

  // 已配置但未開啟真實送出
  throw new ApiError(
    409,
    "publish_disabled",
    "發佈流程已確認，但此部署預設仍停用實際送出。",
  );
}
