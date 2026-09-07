import {
  confirmPublish,
  instagramPublishStatus,
  requestPublishConfirmation,
} from "../publish";
import { ApiError } from "../security";

export interface Publisher {
  id: string;
  publish(input: {
    confirmationToken: unknown;
    idempotencyKey: string;
    accountId: string;
    media: string;
    caption: string;
  }): Promise<{ state: "unknown" | "blocked" | "disabled"; id?: string }>;
}

export const metaPublisher: Publisher = {
  id: "meta-instagram",
  async publish(input) {
    if (!input.confirmationToken)
      throw new ApiError(403, "confirmation_required", "發佈需要伺服器一次性確認。");
    try {
      confirmPublish({
        token: input.confirmationToken,
        caption: input.caption,
        mediaId: input.media,
        target: input.accountId,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === "publish_disabled")
        return { state: "disabled" };
      throw error;
    }
    return { state: "blocked" };
  },
};

export function preparePublish(accountId: string, caption: string, media: string) {
  const status = instagramPublishStatus();
  if (status.enabled === false)
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
  return { status, preview: { caption, media, accountId } };
}
