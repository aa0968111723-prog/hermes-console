import { randomBytes } from "node:crypto";
import { get, put } from "../store";
import { ApiError, hash, limited } from "../security";
import { emailInput } from "../invitations";
import { hashPassword, passwordPolicy, verifyPassword } from "./passwords";
import {
  attachIdentity,
  createUser,
  emailSubject,
  findUserByEmail,
  getUser,
  identityOf,
  saveUser,
} from "./identity";
import { issueSession } from "./session";
import { emailConfigured } from "./providers";
import { sendAuthMail } from "./mail";
import type { AuthToken } from "./types";

const SCOPE = "auth";

function originOk() {
  try {
    const origin = new URL(process.env.CONSOLE_ORIGIN || "");
    return (
      origin.protocol === "https:" ||
      (origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
    );
  } catch {
    return false;
  }
}

function localPasswordOnly() {
  return process.env.CONSOLE_ALLOW_LOCAL_ACCESS === "true" && originOk();
}

function putToken(purpose: AuthToken["purpose"], extra: Partial<AuthToken>) {
  const token = randomBytes(32).toString("hex");
  put("auth_token", SCOPE, {
    id: hash(token),
    purpose,
    expires: Date.now() + (purpose === "verify" ? 24 : 0.25) * 60 * 60_000,
    used: false,
    ...extra,
  } satisfies AuthToken);
  return token;
}

function consumeToken(token: string, purpose: AuthToken["purpose"]) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new ApiError(401, "invalid_login", "連結無效或已使用。");
  const record = get<AuthToken>("auth_token", SCOPE, hash(token));
  if (!record || record.used || record.purpose !== purpose || record.expires < Date.now())
    throw new ApiError(401, "invalid_login", "連結無效或已使用。");
  put("auth_token", SCOPE, { ...record, used: true });
  return record;
}

export async function registerEmail(
  input: {
    email: string;
    password: string;
    name?: string;
  },
  request?: Request,
) {
  limited("auth:email:register", 8, 15 * 60_000);
  const email = emailInput.parse(input.email);
  limited("auth:email:register:" + email, 5, 15 * 60_000);
  const policy = passwordPolicy(input.password);
  if (policy) throw new ApiError(400, "invalid_input", policy);
  if (identityOf("email", emailSubject(email)) || findUserByEmail(email))
    return { message: "若此信箱可使用，我們會寄出後續信件。" };
  if (!emailConfigured() && !localPasswordOnly())
    throw new ApiError(503, "auth_unconfigured", "電子信箱驗證尚未完成寄信設定");
  const user = createUser({
    displayName: (input.name || email).slice(0, 80),
    email,
    emailVerified: localPasswordOnly(),
    passwordHash: hashPassword(input.password),
  });
  attachIdentity({
    userId: user.id,
    provider: "email",
    providerSubject: emailSubject(email),
    email,
    emailVerified: user.emailVerified,
    name: user.displayName,
    avatarUrl: null,
  });
  if (user.emailVerified)
    return {
      message: "本機開發帳號已建立，可直接登入。",
      token: issueSession(user.id, request),
    };
  if (!emailConfigured())
    throw new ApiError(503, "auth_unconfigured", "電子信箱驗證尚未完成寄信設定");
  const token = putToken("verify", { userId: user.id, email });
  await sendAuthMail(
    email,
    "驗證 Hermes 電子信箱",
    "請在 24 小時內開啟此連結完成驗證：\n" +
      process.env.CONSOLE_ORIGIN +
      "/#verify=" +
      token +
      "\n若不是你本人，請忽略此信。",
  );
  return { message: "若此信箱可使用，我們會寄出驗證信。" };
}

export function loginEmail(
  emailRaw: string,
  password: string,
  request?: Request,
) {
  limited("auth:email:login", 20, 15 * 60_000);
  const email = emailInput.parse(emailRaw);
  limited("auth:email:login:" + email, 8, 15 * 60_000);
  const user = findUserByEmail(email);
  const dummy =
    "scrypt:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:" + "11".repeat(64);
  const ok = user?.passwordHash
    ? verifyPassword(password, user.passwordHash)
    : verifyPassword(password, dummy);
  if (!user || user.disabled || !ok)
    throw new ApiError(401, "invalid_login", "帳號或密碼不正確。");
  if (!user.emailVerified && !localPasswordOnly())
    throw new ApiError(401, "email_unverified", "請先完成電子信箱驗證。");
  return { token: issueSession(user.id, request) };
}

export async function requestMagicLink(emailRaw: string) {
  limited("auth:email:magic", 8, 15 * 60_000);
  const email = emailInput.parse(emailRaw);
  const user = findUserByEmail(email);
  const message = "若此信箱可使用，我們會寄出登入連結。";
  if (!emailConfigured())
    throw new ApiError(503, "auth_unconfigured", "電子信箱驗證尚未完成寄信設定");
  if (!user || user.disabled) return { message };
  const token = putToken("magic", { userId: user.id, email });
  await sendAuthMail(
    email,
    "Hermes 登入連結",
    "此連結 15 分鐘內有效且只能使用一次：\n" +
      process.env.CONSOLE_ORIGIN +
      "/#login=" +
      token +
      "\n若不是你本人，請忽略此信。",
  );
  return { message };
}

export function redeemMagic(token: string, request?: Request) {
  const record = consumeToken(token, "magic");
  if (!record.userId) throw new ApiError(401, "invalid_login", "連結無效或已使用。");
  const user = getUser(record.userId);
  if (!user || user.disabled)
    throw new ApiError(401, "invalid_login", "連結無效或已使用。");
  if (!user.emailVerified) {
    saveUser({ ...user, emailVerified: true });
  }
  return { token: issueSession(user.id, request) };
}

export function verifyEmail(token: string, request?: Request) {
  const record = consumeToken(token, "verify");
  if (!record.userId) throw new ApiError(401, "invalid_login", "連結無效或已使用。");
  const user = getUser(record.userId);
  if (!user) throw new ApiError(401, "invalid_login", "連結無效或已使用。");
  saveUser({ ...user, emailVerified: true });
  return { token: issueSession(user.id, request) };
}

export async function requestReset(emailRaw: string) {
  limited("auth:email:reset", 8, 15 * 60_000);
  const email = emailInput.parse(emailRaw);
  const message = "若此信箱可使用，我們會寄出重設連結。";
  if (!emailConfigured())
    throw new ApiError(503, "auth_unconfigured", "電子信箱驗證尚未完成寄信設定");
  const user = findUserByEmail(email);
  if (!user || user.disabled || !user.passwordHash) return { message };
  const token = putToken("reset", { userId: user.id, email });
  await sendAuthMail(
    email,
    "重設 Hermes 密碼",
    "此連結 15 分鐘內有效且只能使用一次：\n" +
      process.env.CONSOLE_ORIGIN +
      "/#reset=" +
      token +
      "\n若不是你本人，請忽略此信。",
  );
  return { message };
}

export function resetPassword(
  token: string,
  password: string,
  request?: Request,
) {
  const policy = passwordPolicy(password);
  if (policy) throw new ApiError(400, "invalid_input", policy);
  const record = consumeToken(token, "reset");
  if (!record.userId) throw new ApiError(401, "invalid_login", "連結無效或已使用。");
  const user = getUser(record.userId);
  if (!user) throw new ApiError(401, "invalid_login", "連結無效或已使用。");
  saveUser({ ...user, passwordHash: hashPassword(password), emailVerified: true });
  return { token: issueSession(user.id, request) };
}
