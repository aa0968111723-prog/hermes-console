import {
  confirmPublish,
  instagramPublishStatus,
  requestPublishConfirmation,
} from "../publish";
import { ApiError } from "../security";

export interface PublishInput {
  confirmationToken: unknown;
  idempotencyKey: string;
  accountId: string;
  media: string;
  caption: string;
  options?: {
    allowSandboxSimulation?: boolean;
  };
}

export interface PublishResult {
  state: "unknown" | "blocked" | "disabled" | "published" | "sandbox_simulated";
  id?: string;
  mode?: "live_meta_graph_api" | "sandbox_audit_simulation";
  containerId?: string;
  mediaId?: string;
  publishedAt?: string;
  auditTrail?: {
    idempotencyKey?: string;
    accountId?: string;
    timestamp?: string;
    captionLength?: number;
    mediaUrl?: string;
    disclaimer?: string;
    target?: string;
    caption?: string;
    mediaId?: string;
  };
  idempotentCached?: boolean;
}

export interface Publisher {
  id: string;
  publish(input: PublishInput): Promise<PublishResult>;
}

// 冪等快取，防止相同 idempotencyKey 重複發布 (最多保全 500 筆，1 小時有效)
const MAX_IDEMPOTENCY_ENTRIES = 500;
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;
const idempotencyStore = new Map<string, { timestamp: number; result: PublishResult }>();

function cleanupIdempotencyStore(): void {
  const now = Date.now();
  for (const [key, val] of idempotencyStore.entries()) {
    if (now - val.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyStore.delete(key);
    }
  }
  if (idempotencyStore.size > MAX_IDEMPOTENCY_ENTRIES) {
    const oldestKey = idempotencyStore.keys().next().value;
    if (oldestKey) idempotencyStore.delete(oldestKey);
  }
}

export const metaPublisher: Publisher = {
  id: "meta-instagram",
  async publish(input: PublishInput): Promise<PublishResult> {
    if (!input.confirmationToken) {
      throw new ApiError(403, "confirmation_required", "發佈需要伺服器一次性確認。");
    }

    // 檢驗冪等性防重複發布
    cleanupIdempotencyStore();
    if (input.idempotencyKey && idempotencyStore.has(input.idempotencyKey)) {
      const cached = idempotencyStore.get(input.idempotencyKey)!;
      return {
        ...cached.result,
        idempotentCached: true,
      };
    }

    try {
      const confirmRes = confirmPublish({
        token: input.confirmationToken,
        caption: input.caption,
        mediaId: input.media,
        target: input.accountId,
        allowSandbox: input.options?.allowSandboxSimulation ?? false,
      });

      const result: PublishResult = {
        state: confirmRes.state,
        id: confirmRes.id,
        mode: confirmRes.mode,
        publishedAt: confirmRes.publishedAt,
        containerId: confirmRes.containerId,
        mediaId: confirmRes.mediaId,
        auditTrail: {
          idempotencyKey: input.idempotencyKey,
          accountId: input.accountId,
          timestamp: confirmRes.publishedAt,
          captionLength: input.caption.length,
          mediaUrl: input.media,
          disclaimer: confirmRes.auditTrail?.disclaimer || "發布審核完成",
        },
      };

      if (input.idempotencyKey) {
        idempotencyStore.set(input.idempotencyKey, {
          timestamp: Date.now(),
          result,
        });
      }

      return result;
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "publish_disabled") {
          return { state: "disabled" };
        }
        if (error.code === "publish_blocked") {
          return { state: "blocked" };
        }
      }
      throw error;
    }
  },
};

export function preparePublish(accountId: string, caption: string, media: string) {
  const status = instagramPublishStatus();
  if (status.enabled === false) {
    return {
      status,
      preview: { caption, media, accountId },
      confirmation: requestPublishConfirmation({
        caption,
        mediaId: media,
        target: accountId,
      }),
      autoRetry: false,
      timeoutPolicy: "unknown_then_query_status",
    };
  }
  return { status, preview: { caption, media, accountId } };
}
