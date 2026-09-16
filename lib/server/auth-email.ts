import { randomUUID } from "node:crypto";
import { ApiError, limited } from "./security";
import {
  consumeAuthToken,
  emailInput,
  findIdentity,
  issueSession,
  linkEmailIdentity,
  loginEmail,
  markEmailVerified,
  putAuthToken,
  readUser,
  registerEmail,
  sessionCookie,
  setPassword,
} from "./identity";
import { localAuthConvenience } from "./env";

function mailConfig() {
  const from = process.env.CONSOLE_EMAIL_FROM?.trim() || "";
  const key = process.env.RESEND_API_KEY?.trim() || "";
  let origin: URL;
  try {
    origin = new URL(process.env.CONSOLE_ORIGIN || "");
  } catch {
    throw new ApiError(503, "setup_required", "尚未設定 CONSOLE_ORIGIN。");
  }
  const local =
    origin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    !from ||
    !key ||
    origin.username ||
    origin.password ||
    !(origin.protocol === "https:" || local)
  )
    throw new ApiError(
      503,
      "setup_required",
      "電子信箱驗證／重設尚未設定寄信服務。",
    );
  return { from, origin: origin.origin, key };
}

async function sendMail(to: string, subject: string, text: string) {
  const config = mailConfig();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: "Bearer " + config.key,
      "Content-Type": "application/json",
      "Idempotency-Key": "hermes-auth-" + randomUUID(),
    },
    body: JSON.stringify({ from: config.from, to: [to], subject, text }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof (payload as { id?: string }).id !== "string")
    throw new ApiError(502, "email_failed", "寄信服務未確認接受，請稍後重試。");
}

const genericInbox =
  "若此信箱已有帳號，系統會嘗試寄出信件。未收到時請稍後再試，請勿大量重送。";

export async function registerWithEmail(input: {
  email: string;
  password: string;
  name: string;
}) {
  const result = registerEmail(input);
  if (result.verified)
    return {
      signedIn: true,
      verified: true,
      cookie: sessionCookie(issueSession(result.user.id)),
      message: "本機開發已直接驗證電子信箱。",
    };
  try {
    const token = putAuthToken({
      type: "verify",
      userId: result.user.id,
      ttlMs: 24 * 60 * 60_000,
    });
    const origin = new URL(process.env.CONSOLE_ORIGIN || "").origin;
    await sendMail(
      result.user.email!,
      "驗證 Hermes 電子信箱",
      "請在 24 小時內開啟此連結完成驗證：\n" +
        origin +
        "/#verify=" +
        token +
        "\n若非你本人操作，請忽略此信。",
    );
  } catch {
    /* Public register does not reveal mail failures. */
  }
  return {
    signedIn: false,
    verified: false,
    message: "請查收驗證信。未設定寄信時無法完成驗證。",
  };
}

export async function linkEmailToUser(
  userId: string,
  email: string,
  password: string,
) {
  const user = linkEmailIdentity(userId, email, password);
  if (localAuthConvenience())
    return {
      linked: true,
      verified: true,
      message: "本機開發已連結並驗證電子信箱。",
    };
  try {
    const token = putAuthToken({
      type: "verify",
      userId,
      ttlMs: 24 * 60 * 60_000,
    });
    const origin = new URL(process.env.CONSOLE_ORIGIN || "").origin;
    await sendMail(
      email,
      "驗證 Hermes 電子信箱",
      "請在 24 小時內開啟此連結完成驗證：\n" +
        origin +
        "/#verify=" +
        token +
        "\n若非你本人操作，請忽略此信。",
    );
  } catch {
    /* Linking does not reveal whether mail was accepted. */
  }
  return {
    linked: true,
    verified: user.emailVerified,
    message: "已連結電子信箱。未驗證前請查收驗證信。",
  };
}

export function signInWithEmail(email: string, password: string) {
  const user = loginEmail(email, password);
  if (!user.emailVerified && !localAuthConvenience())
    throw new ApiError(403, "email_unverified", "請先完成電子信箱驗證。");
  return { cookie: sessionCookie(issueSession(user.id)) };
}

export async function requestMagicLink(raw: string) {
  const email = emailInput.parse(raw);
  limited("email:global", 30, 15 * 60_000);
  limited("email:" + email, 5, 15 * 60_000);
  const identity = findIdentity("email", email);
  if (identity) {
    try {
      const token = putAuthToken({
        type: "magic",
        userId: identity.userId,
        ttlMs: 15 * 60_000,
      });
      const origin = new URL(process.env.CONSOLE_ORIGIN || "").origin;
      await sendMail(
        email,
        "Hermes 登入連結",
        "此連結 15 分鐘內有效且只能使用一次：\n" +
          origin +
          "/#login=" +
          token +
          "\n若非你要求，請忽略此信。",
      );
    } catch {
      /* same generic response */
    }
  }
  return { message: genericInbox };
}

export function redeemMagicLink(token: string) {
  limited("redeem:global", 60, 15 * 60_000);
  const userId = consumeAuthToken("magic", token);
  const user = markEmailVerified(userId) || readUser(userId);
  if (!user) throw new ApiError(401, "invalid_link", "連結無效或已過期。");
  return { cookie: sessionCookie(issueSession(user.id)) };
}

export function verifyEmailToken(token: string) {
  const userId = consumeAuthToken("verify", token);
  const user = markEmailVerified(userId);
  if (!user) throw new ApiError(401, "invalid_link", "連結無效或已過期。");
  return { cookie: sessionCookie(issueSession(user.id)) };
}

export async function requestPasswordReset(raw: string) {
  const email = emailInput.parse(raw);
  limited("reset:global", 20, 15 * 60_000);
  limited("reset:" + email, 3, 15 * 60_000);
  const identity = findIdentity("email", email);
  if (identity) {
    try {
      const token = putAuthToken({
        type: "reset",
        userId: identity.userId,
        ttlMs: 30 * 60_000,
      });
      const origin = new URL(process.env.CONSOLE_ORIGIN || "").origin;
      await sendMail(
        email,
        "重設 Hermes 密碼",
        "此連結 30 分鐘內有效且只能使用一次：\n" +
          origin +
          "/#reset=" +
          token +
          "\n若非你要求，請忽略此信。",
      );
    } catch {
      /* same generic response */
    }
  }
  return { message: genericInbox };
}

export function resetPassword(token: string, password: string) {
  const userId = consumeAuthToken("reset", token);
  setPassword(userId, password);
  markEmailVerified(userId);
  return { cookie: sessionCookie(issueSession(userId)) };
}
