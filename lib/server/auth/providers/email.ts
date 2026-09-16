import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ApiError, hash, limited } from "../../security";
import { emailInput } from "../../invitations";
import { mailConfigured } from "../mode";
import { hashPassword, verifySecret } from "../password";
import {
  createUser,
  findIdentity,
  getAuthToken,
  getCredential,
  getUser,
  linkIdentity,
  putAuthToken,
  putCredential,
  consumeAuthToken,
  saveUser,
  touchCredential,
  type AuthUser,
} from "../identity";
import { issueSession } from "../session";

const passwordInput = z.string().min(10).max(200);

function origin() {
  try {
    return new URL(process.env.CONSOLE_ORIGIN || "").origin;
  } catch {
    throw new ApiError(503, "setup_required", "後端尚未設定 CONSOLE_ORIGIN。");
  }
}

async function sendMail(to: string, subject: string, text: string) {
  if (!mailConfigured())
    throw new ApiError(
      503,
      "AUTH_ERROR",
      "電子信箱驗證／信件登入尚未完成寄信設定。",
      "AUTH_ERROR",
    );
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.CONSOLE_EMAIL_FROM,
      to: [to],
      subject,
      text,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof (payload as { id?: string }).id !== "string")
    throw new ApiError(502, "email_failed", "寄信服務未確認接受。", "UPSTREAM_ERROR");
}

function issueToken(userId: string, purpose: "verify_email" | "reset_password" | "magic_link") {
  const token = randomBytes(32).toString("hex");
  const ttl =
    purpose === "magic_link" ? 15 * 60_000 : purpose === "reset_password" ? 60 * 60_000 : 24 * 60 * 60_000;
  putAuthToken(hash(token), {
    userId,
    purpose,
    expiresAt: Date.now() + ttl,
    used: false,
  });
  return token;
}

export async function registerEmail(rawEmail: string, rawPassword: string) {
  const email = emailInput.parse(rawEmail);
  const password = passwordInput.parse(rawPassword);
  limited("email:register:" + hash(email), 5, 15 * 60_000);
  limited("email:register:global", 20, 15 * 60_000);
  if (findIdentity("email", email))
    throw new ApiError(409, "AUTH_ERROR", "此電子信箱已註冊。", "AUTH_ERROR");
  const user = createUser({
    email,
    emailVerified: false,
    name: email.split("@")[0] || "Hermes 使用者",
  });
  linkIdentity(user.id, {
    provider: "email",
    subject: email,
    email,
    emailVerified: false,
  });
  putCredential(user.id, await hashPassword(password));
  if (mailConfigured()) {
    const token = issueToken(user.id, "verify_email");
    try {
      await sendMail(
        email,
        "驗證 Hermes 電子信箱",
        "請在 24 小時內開啟（一次性）：\n" + origin() + "/#verify=" + token,
      );
    } catch {
      /* public response does not reveal delivery */
    }
  }
  const session = issueSession(user.id);
  return {
    ...session,
    emailVerified: false,
    mail: mailConfigured() ? "sent" : "unconfigured",
    message: mailConfigured()
      ? "已建立帳號。請至信箱完成驗證。"
      : "已建立帳號。寄信尚未設定，電子信箱仍標為未驗證。",
  };
}

export async function loginEmail(rawEmail: string, rawPassword: string) {
  const email = emailInput.parse(rawEmail);
  const password = passwordInput.parse(rawPassword);
  limited("email:login:global", 20, 15 * 60_000);
  limited("email:login:" + hash(email), 8, 15 * 60_000);
  const identity = findIdentity("email", email);
  const user = identity ? getUser(identity.userId) : null;
  const credential = user ? getCredential(user.id) : null;
  if (!user || !credential)
    throw new ApiError(401, "AUTH_ERROR", "電子信箱或密碼不正確。", "AUTH_ERROR");
  if (credential.lockedUntil > Date.now())
    throw new ApiError(429, "RATE_LIMIT", "嘗試次數過多，請稍後再試。", "RATE_LIMIT");
  const ok = await verifySecret(password, credential.passwordHash);
  if (!ok) {
    const attempts = credential.attempts + 1;
    touchCredential({
      ...credential,
      attempts,
      lockedUntil: attempts >= 8 ? Date.now() + 15 * 60_000 : 0,
    });
    throw new ApiError(401, "AUTH_ERROR", "電子信箱或密碼不正確。", "AUTH_ERROR");
  }
  touchCredential({ ...credential, attempts: 0, lockedUntil: 0 });
  return issueSession(user.id);
}

export async function requestMagicLink(rawEmail: string) {
  const email = emailInput.parse(rawEmail);
  limited("email:magic:" + hash(email), 5, 15 * 60_000);
  const identity = findIdentity("email", email);
  if (identity && mailConfigured()) {
    const token = issueToken(identity.userId, "magic_link");
    try {
      await sendMail(
        email,
        "Hermes 一次性登入連結",
        "此連結 15 分鐘內有效且只能使用一次：\n" + origin() + "/#login=" + token,
      );
    } catch {
      /* do not reveal delivery or whether the address exists */
    }
  }
  return {
    message: "若此信箱已註冊且寄信已設定，系統將寄出一次性登入連結。",
  };
}

export function redeemToken(token: string, purpose: "verify_email" | "reset_password" | "magic_link") {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new ApiError(401, "invalid_link", "連結無效。", "AUTH_ERROR");
  const record = consumeAuthToken(hash(token));
  if (record.purpose !== purpose)
    throw new ApiError(401, "invalid_link", "連結用途不符。", "AUTH_ERROR");
  const user = getUser(record.userId);
  if (!user) throw new ApiError(401, "AUTH_ERROR", "帳號不存在。", "AUTH_ERROR");
  return user;
}

export function verifyEmail(token: string) {
  const user = redeemToken(token, "verify_email");
  saveUser({ ...user, emailVerified: true });
  const identity = findIdentity("email", user.email || "");
  if (identity)
    linkIdentity(user.id, {
      ...identity,
      emailVerified: true,
    });
  return issueSession(user.id);
}

export function redeemMagicLink(token: string) {
  return issueSession(redeemToken(token, "magic_link").id);
}

export async function requestPasswordReset(rawEmail: string) {
  const email = emailInput.parse(rawEmail);
  limited("email:reset:" + hash(email), 5, 15 * 60_000);
  const identity = findIdentity("email", email);
  if (identity && mailConfigured()) {
    const token = issueToken(identity.userId, "reset_password");
    try {
      await sendMail(
        email,
        "重設 Hermes 密碼",
        "此連結 1 小時內有效且只能使用一次：\n" + origin() + "/#reset=" + token,
      );
    } catch {
      /* do not reveal delivery or whether the address exists */
    }
  }
  return { message: "若此信箱已註冊且寄信已設定，系統將寄出重設連結。" };
}

export async function requestEmailVerification(userId: string) {
  limited("email:verify:" + userId, 5, 15 * 60_000);
  const user = getUser(userId);
  if (!user?.email)
    return { message: "尚未連結電子信箱。" };
  if (user.emailVerified) return { message: "電子信箱已驗證。" };
  if (mailConfigured()) {
    const token = issueToken(user.id, "verify_email");
    try {
      await sendMail(
        user.email,
        "驗證 Hermes 電子信箱",
        "請在 24 小時內開啟（一次性）：\n" + origin() + "/#verify=" + token,
      );
    } catch {
      /* public response does not reveal delivery */
    }
  }
  return {
    message: mailConfigured()
      ? "若寄信已設定，系統將寄出驗證信。"
      : "寄信尚未完成設定。電子信箱仍標為未驗證。",
  };
}

export async function resetPassword(token: string, rawPassword: string) {
  const password = passwordInput.parse(rawPassword);
  const user = redeemToken(token, "reset_password");
  putCredential(user.id, await hashPassword(password));
  return issueSession(user.id);
}

export function peekTokenForTests(token: string) {
  if (!process.env.NODE_TEST_CONTEXT) return null;
  return getAuthToken(hash(token));
}

export type { AuthUser };
