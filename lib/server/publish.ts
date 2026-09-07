import { ApiError, consumeConfirmation, mintConfirmation } from "./security";

export function instagramPublishStatus() {
  const configured = !!(
    process.env.INSTAGRAM_CLIENT_ID && process.env.INSTAGRAM_CLIENT_SECRET
  );
  return {
    enabled: false,
    configured,
    authorized: false,
    publishScope: false,
    state: configured ? "needs_authorization" : "unconfigured",
    message: configured
      ? "Instagram 發佈預設關閉。需要官方 OAuth、publish 權限、內容準備完成，以及伺服器一次性確認。"
      : "尚未設定 INSTAGRAM_CLIENT_ID／SECRET；發佈保持關閉。",
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

export function confirmPublish(input: {
  token?: unknown;
  caption: string;
  mediaId: string;
  target: string;
  confirmed?: unknown;
}) {
  if (input.confirmed === true)
    throw new ApiError(
      403,
      "confirmation_required",
      "前端 confirmed=true 不足；發佈必須使用伺服器一次性確認。",
    );
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
  if (!status.enabled || !status.authorized || !status.publishScope)
    throw new ApiError(
      409,
      "publish_blocked",
      "尚未完成官方 OAuth 與 publish 權限，發佈未執行。",
    );
  throw new ApiError(
    409,
    "publish_disabled",
    "發佈流程已確認，但此部署預設仍停用實際送出。",
  );
}
