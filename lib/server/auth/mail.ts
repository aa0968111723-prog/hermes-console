import { randomUUID } from "node:crypto";
import { ApiError } from "../security";
import { emailInput } from "../invitations";

export async function sendAuthMail(to: string, subject: string, text: string) {
  const sender = emailInput.safeParse(process.env.CONSOLE_EMAIL_FROM);
  if (!sender.success || !process.env.RESEND_API_KEY)
    throw new ApiError(503, "auth_unconfigured", "電子信箱驗證尚未完成寄信設定");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": "console-auth-" + randomUUID(),
    },
    body: JSON.stringify({ from: sender.data, to: [to], subject, text }),
  });
  if (!response.ok)
    throw new ApiError(503, "UPSTREAM_ERROR", "寄信服務暫時無法使用。");
}
