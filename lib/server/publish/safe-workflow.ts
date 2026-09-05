/**
 * Safe social publishing workflow.
 * Never auto-posts to Meta/Instagram. Live Graph is an irreversible external action.
 */
import {
  instagramPublishStatus,
  requestPublishConfirmation,
  type InstagramPublishStatusResult,
} from "../publish.ts";
import { socialDrafts } from "../creative/social.ts";

export interface SafePublishPrepareInput {
  caption: string;
  mediaId?: string;
  target?: string;
  platform?: "instagram";
  title?: string;
  copy?: string;
  cta?: string;
  audience?: string;
}

export interface SafePublishWorkflow {
  published: false;
  livePosted: false;
  autoRetry: false;
  requiresConfirmation: true;
  queued: boolean;
  mode: "sandbox_simulation" | "unconfigured" | "needs_authorization" | "queued_not_sent";
  status: InstagramPublishStatusResult;
  confirmation: { token: string; expiresAt: number };
  preview: {
    platform: "instagram";
    caption: string;
    mediaId: string;
    target: string;
  };
  drafts: ReturnType<typeof socialDrafts>;
  note: string;
}

export function prepareSafeSocialPublish(input: SafePublishPrepareInput): SafePublishWorkflow {
  const status = instagramPublishStatus();
  const caption = input.caption.slice(0, 2200);
  const mediaId = input.mediaId || "local_blueprint_media";
  const target = input.target || "instagram:workspace";
  const confirmation = requestPublishConfirmation({
    caption,
    mediaId,
    target,
  });
  const mode: SafePublishWorkflow["mode"] = status.enabled
    ? "queued_not_sent"
    : status.state === "needs_authorization"
      ? "needs_authorization"
      : status.state === "unconfigured"
        ? "unconfigured"
        : "sandbox_simulation";
  const note = status.enabled
    ? "ENABLE_LIVE_PUBLISH 已開，但本控制台不呼叫 Meta Graph（不可逆外部動作）。僅排隊，未真實發文。"
    : status.state === "sandbox"
      ? "未配置正式金鑰或未開啟 ENABLE_LIVE_PUBLISH，系統以沙盒模擬模式產生發布封包與審核紀錄"
      : status.message;
  return {
    published: false,
    livePosted: false,
    autoRetry: false,
    requiresConfirmation: true,
    queued: mode === "queued_not_sent" || mode === "sandbox_simulation",
    mode,
    status,
    confirmation: { token: confirmation.token, expiresAt: confirmation.expiresAt },
    preview: {
      platform: "instagram",
      caption,
      mediaId,
      target,
    },
    drafts: socialDrafts({
      title: input.title || caption.slice(0, 40),
      copy: input.copy || caption,
      cta: input.cta || "來坐一下",
      audience: input.audience || "大一新生",
    }),
    note,
  };
}

export function describeMcpSandboxPublish(input: {
  platform: string;
  caption: string;
  idempotencyKey?: string;
}) {
  const prepared = prepareSafeSocialPublish({
    caption: input.caption,
    platform: "instagram",
  });
  return {
    published: false,
    livePosted: false,
    simulated: true,
    mode: "sandbox_simulation" as const,
    platform: input.platform,
    publishedAt: null,
    status: "已排程至安全沙盒預備發布隊列（待配置正式金鑰或開啟 ENABLE_LIVE_PUBLISH）",
    note: prepared.note.includes("沙盒")
      ? prepared.note
      : `${prepared.note}（沙盒模擬模式，未向 Meta 發出真實請求）`,
    captionPreview: String(input.caption).slice(0, 80) + (input.caption.length > 80 ? "..." : ""),
    idempotencyKey: input.idempotencyKey || `idem_${Date.now()}`,
    auditTrail: {
      idempotencyKey: input.idempotencyKey || null,
      platform: input.platform,
      captionLength: String(input.caption).length,
      timestamp: new Date().toISOString(),
      disclaimer: "安全沙盒模擬發布完成，具備完整審核軌跡，未向外部 Meta 發出真實請求。",
    },
  };
}
