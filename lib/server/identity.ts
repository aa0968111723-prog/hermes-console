import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { argon2id } from "@noble/hashes/argon2";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { z } from "zod";
import { ApiError } from "./errors";
import { get, list, put, remove, transaction } from "./store";
import { emailInput } from "./invitations";
import { limited, WORKSPACE_OWNER, hash } from "./security";

export type AuthProvider = "google" | "tamkang" | "email";
export type MembershipRole = "owner" | "admin" | "member";

export type User = {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  passwordHash: string | null;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Identity = {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerId: string;
  email: string | null;
  emailVerified: boolean;
  createdAt: string;
};

export type AuthSession = {
  id: string;
  userId: string;
  expires: number;
  createdAt: string;
};

export type Membership = {
  id: string;
  userId: string;
  workspaceId: string;
  role: MembershipRole;
  createdAt: string;
};

type AuthToken = {
  id: string;
  purpose: "verify" | "reset" | "magic" | "oauth";
  userId: string | null;
  provider?: AuthProvider;
  mode?: "login" | "link";
  verifier?: string;
  redirect?: string;
  expires: number;
  used: boolean;
};

const SCOPE = "identity";
const ARGON = { t: 2, m: 19456, p: 1, dkLen: 32 };
const SESSION_MS = 12 * 60 * 60_000;
const TOKEN_MS = 15 * 60_000;

export const passwordInput = z
  .string()
  .min(12, "密碼至少 12 字元。")
  .max(200);

function nowIso() {
  return new Date().toISOString();
}

function identityKey(provider: AuthProvider, providerId: string) {
  return hash(provider + ":" + providerId);
}

export function readCookie(request: Request, name: string) {
  return (
    (request.headers.get("cookie") || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}

export function sessionHeader(token = "") {
  const secure = process.env.CONSOLE_ORIGIN?.startsWith("https:")
    ? "; Secure"
    : "";
  return (
    "hermes_session=" +
    token +
    "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" +
    (token ? "43200" : "0") +
    secure
  );
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const digest = argon2id(password, salt, ARGON);
  return (
    "argon2id$v=19$m=" +
    ARGON.m +
    ",t=" +
    ARGON.t +
    ",p=" +
    ARGON.p +
    "$" +
    bytesToHex(salt) +
    "$" +
    bytesToHex(digest)
  );
}

export function verifyPasswordHash(password: string, encoded: string) {
  if (encoded.startsWith("scrypt:")) {
    const [, salt, value] = encoded.split(":");
    if (!/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(value || ""))
      return false;
    return timingSafeEqual(
      scryptSync(password, salt, 64),
      Buffer.from(value, "hex"),
    );
  }
  const parts = encoded.split("$");
  if (parts[0] !== "argon2id" || parts.length !== 5) return false;
  const salt = hexToBytes(parts[3] || "");
  const expected = hexToBytes(parts[4] || "");
  if (salt.length < 8 || expected.length < 16) return false;
  const actual = argon2id(password, salt, ARGON);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function users() {
  return list<User>("user", SCOPE);
}

export function identitiesFor(userId: string) {
  return list<Identity>("identity", SCOPE).filter((row) => row.userId === userId);
}

export function membershipFor(userId: string) {
  return get<Membership>("membership", WORKSPACE_OWNER, userId);
}

export function publicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerified,
  };
}

export function providerStatus() {
  const google = !!(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
  const tamkang = tamkangConfigured();
  const mail = !!(
    process.env.RESEND_API_KEY?.trim() && process.env.CONSOLE_EMAIL_FROM?.trim()
  );
  return {
    google: {
      configured: google,
      label: google ? "Google" : "Google 登入尚未完成設定",
    },
    tamkang: {
      configured: tamkang.configured,
      protocol: tamkang.protocol,
      label: tamkang.configured
        ? "淡江 SSO"
        : "淡江 SSO 尚未完成設定",
    },
    email: {
      configured: true,
      mail,
      label: mail ? "電子信箱" : "電子信箱（本機可不寄信；正式環境需設定寄件）",
    },
  };
}

export function tamkangConfigured() {
  const protocol = (process.env.TAMKANG_SSO_PROTOCOL || "oidc").toLowerCase();
  const issuer = process.env.TAMKANG_SSO_ISSUER?.trim() || "";
  const clientId = process.env.TAMKANG_SSO_CLIENT_ID?.trim() || "";
  const secret = process.env.TAMKANG_SSO_CLIENT_SECRET?.trim() || "";
  const metadata = process.env.TAMKANG_SSO_METADATA_URL?.trim() || "";
  const configured = !!(
    clientId &&
    (issuer || metadata) &&
    (protocol === "oidc" || protocol === "oauth" ? secret : true)
  );
  return { protocol, issuer, clientId, metadata, configured };
}

export function currentUser(request: Request) {
  const token = readCookie(request, "hermes_session");
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new ApiError(401, "sign_in_required", "請先登入。");
  const session = get<AuthSession>("auth_session", SCOPE, hash(token));
  const user = session ? get<User>("user", SCOPE, session.userId) : null;
  if (!session || session.expires <= Date.now() || !user)
    throw new ApiError(401, "session_expired", "登入已過期，請重新登入。");
  return user;
}

export function requireWorkspaceMember(request: Request) {
  const user = currentUser(request);
  const membership = membershipFor(user.id);
  if (!membership)
    throw new ApiError(
      403,
      "membership_required",
      "這個帳號還沒有工作區權限。",
    );
  return { user, membership };
}

export function issueSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  put("auth_session", SCOPE, {
    id: hash(token),
    userId,
    expires: Date.now() + SESSION_MS,
    createdAt: nowIso(),
  } satisfies AuthSession);
  return token;
}

export function destroySession(request: Request) {
  const token = readCookie(request, "hermes_session");
  if (/^[a-f0-9]{64}$/.test(token))
    remove("auth_session", SCOPE, hash(token));
}

function ensureMembership(userId: string, role: MembershipRole) {
  const existing = membershipFor(userId);
  if (existing) return existing;
  return put("membership", WORKSPACE_OWNER, {
    id: userId,
    userId,
    workspaceId: WORKSPACE_OWNER,
    role,
    createdAt: nowIso(),
  } satisfies Membership);
}

function createUser(input: {
  name: string;
  email: string | null;
  avatarUrl?: string | null;
  passwordHash?: string | null;
  emailVerified: boolean;
}) {
  const user: User = {
    id: randomUUID(),
    name: input.name,
    email: input.email,
    avatarUrl: input.avatarUrl || null,
    passwordHash: input.passwordHash || null,
    emailVerified: input.emailVerified,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  put("user", SCOPE, user);
  const owners = list<Membership>("membership", WORKSPACE_OWNER).filter(
    (row) => row.role === "owner",
  );
  ensureMembership(user.id, owners.length ? "member" : "owner");
  return user;
}

function putIdentity(input: {
  userId: string;
  provider: AuthProvider;
  providerId: string;
  email: string | null;
  emailVerified: boolean;
}) {
  return put("identity", SCOPE, {
    id: identityKey(input.provider, input.providerId),
    userId: input.userId,
    provider: input.provider,
    providerId: input.providerId,
    email: input.email,
    emailVerified: input.emailVerified,
    createdAt: nowIso(),
  } satisfies Identity);
}

export function findIdentity(provider: AuthProvider, providerId: string) {
  return get<Identity>("identity", SCOPE, identityKey(provider, providerId));
}

function mintToken(input: Omit<AuthToken, "id" | "used"> & { token?: string }) {
  const token = input.token || randomBytes(32).toString("hex");
  put("auth_token", SCOPE, {
    id: hash(token),
    purpose: input.purpose,
    userId: input.userId,
    provider: input.provider,
    mode: input.mode,
    verifier: input.verifier,
    redirect: input.redirect,
    expires: input.expires,
    used: false,
  } satisfies AuthToken);
  return token;
}

function consumeToken(token: string, purpose: AuthToken["purpose"]) {
  return transaction(() => {
    const record = get<AuthToken>("auth_token", SCOPE, hash(token));
    if (
      !record ||
      record.used ||
      record.purpose !== purpose ||
      record.expires <= Date.now()
    )
      throw new ApiError(401, "invalid_link", "連結已使用、已過期或不存在。");
    put("auth_token", SCOPE, { ...record, used: true });
    return record;
  });
}

async function sendMail(to: string, subject: string, text: string, key: string) {
  const sender = emailInput.safeParse(process.env.CONSOLE_EMAIL_FROM);
  if (!sender.success || !process.env.RESEND_API_KEY)
    throw new ApiError(503, "email_unconfigured", "尚未設定寄件服務，無法寄信。");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({ from: sender.data, to: [to], subject, text }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof (payload as { id?: string }).id !== "string")
    throw new ApiError(502, "email_failed", "寄信服務未確認接受，請稍後重試。");
}

function originUrl() {
  try {
    return new URL(process.env.CONSOLE_ORIGIN || "").origin;
  } catch {
    throw new ApiError(503, "setup_required", "後端尚未設定 CONSOLE_ORIGIN。");
  }
}

export async function registerEmail(input: {
  email: string;
  password: string;
  name: string;
}) {
  const email = emailInput.parse(input.email);
  const password = passwordInput.parse(input.password);
  const name = z.string().trim().min(1).max(80).parse(input.name);
  limited("register:global", 20, 15 * 60_000);
  limited("register:" + hash(email), 5, 15 * 60_000);
  if (findIdentity("email", email))
    throw new ApiError(409, "email_taken", "此信箱已有帳號，請改為登入。");
  const first = users().length === 0;
  const user = createUser({
    name,
    email,
    passwordHash: hashPassword(password),
    emailVerified: first,
  });
  putIdentity({
    userId: user.id,
    provider: "email",
    providerId: email,
    email,
    emailVerified: first,
  });
  if (first) return { user: publicUser(user), token: issueSession(user.id), first: true };
  if (!providerStatus().email.mail)
    throw new ApiError(
      503,
      "email_unconfigured",
      "帳號已建立，但尚未設定寄件，無法完成驗證。請使用已設定的 Google／淡江，或請擁有者完成寄信設定。",
    );
  const token = mintToken({
    purpose: "verify",
    userId: user.id,
    expires: Date.now() + TOKEN_MS,
  });
  await sendMail(
    email,
    "驗證 Hermes 帳號",
    "請在 15 分鐘內開啟此連結完成驗證：\n" +
      originUrl() +
      "/#verify=" +
      token +
      "\n若非你本人操作，請忽略此信。",
    "verify-" + user.id + "-" + token.slice(0, 8),
  );
  return { user: publicUser(user), token: null, first: false };
}

export function loginEmail(input: { email: string; password: string }) {
  const email = emailInput.parse(input.email);
  limited("login:global", 20, 15 * 60_000);
  limited("login:" + hash(email), 8, 15 * 60_000);
  const identity = findIdentity("email", email);
  const user = identity ? get<User>("user", SCOPE, identity.userId) : null;
  if (!user?.passwordHash || !verifyPasswordHash(input.password, user.passwordHash))
    throw new ApiError(401, "invalid_login", "帳號或密碼不正確。");
  if (!user.emailVerified)
    throw new ApiError(403, "unverified_email", "請先完成電子信箱驗證。");
  ensureMembership(user.id, "member");
  return issueSession(user.id);
}

export function verifyEmail(token: string) {
  limited("verify:global", 60, 15 * 60_000);
  const record = consumeToken(token, "verify");
  const user = record.userId ? get<User>("user", SCOPE, record.userId) : null;
  if (!user) throw new ApiError(401, "invalid_link", "驗證連結無效。");
  put("user", SCOPE, { ...user, emailVerified: true, updatedAt: nowIso() });
  for (const identity of identitiesFor(user.id).filter((row) => row.provider === "email"))
    put("identity", SCOPE, { ...identity, emailVerified: true });
  ensureMembership(user.id, "member");
  return issueSession(user.id);
}

export async function requestMagicLink(emailRaw: string) {
  const email = emailInput.parse(emailRaw);
  limited("magic:global", 30, 15 * 60_000);
  limited("magic:" + hash(email), 5, 15 * 60_000);
  const identity = findIdentity("email", email);
  const user = identity ? get<User>("user", SCOPE, identity.userId) : null;
  if (user?.emailVerified && providerStatus().email.mail) {
    const token = mintToken({
      purpose: "magic",
      userId: user.id,
      expires: Date.now() + TOKEN_MS,
    });
    try {
      await sendMail(
        email,
        "Hermes 登入連結",
        "此連結 15 分鐘內有效且只能使用一次：\n" +
          originUrl() +
          "/#login=" +
          token +
          "\n若非你要求，請忽略此信。",
        "magic-" + user.id + "-" + Date.now(),
      );
    } catch {
      /* do not reveal whether the mailbox exists */
    }
  }
  return {
    message:
      "若此信箱已註冊，系統將嘗試寄出登入連結。未收到時請改用密碼或聯絡管理員。",
  };
}

export function redeemMagicLink(token: string) {
  limited("redeem:global", 60, 15 * 60_000);
  const record = consumeToken(token, "magic");
  const user = record.userId ? get<User>("user", SCOPE, record.userId) : null;
  if (!user) throw new ApiError(401, "invalid_link", "登入連結無效。");
  ensureMembership(user.id, "member");
  return issueSession(user.id);
}

export async function requestPasswordReset(emailRaw: string) {
  const email = emailInput.parse(emailRaw);
  limited("reset:global", 20, 15 * 60_000);
  limited("reset:" + hash(email), 5, 15 * 60_000);
  const identity = findIdentity("email", email);
  const user = identity ? get<User>("user", SCOPE, identity.userId) : null;
  if (user && providerStatus().email.mail) {
    const token = mintToken({
      purpose: "reset",
      userId: user.id,
      expires: Date.now() + TOKEN_MS,
    });
    try {
      await sendMail(
        email,
        "重設 Hermes 密碼",
        "此連結 15 分鐘內有效且只能使用一次：\n" +
          originUrl() +
          "/#reset=" +
          token,
        "reset-" + user.id + "-" + Date.now(),
      );
    } catch {
      /* same response whether mail failed */
    }
  }
  return { message: "若此信箱已註冊，系統將嘗試寄出重設連結。" };
}

export function resetPassword(token: string, passwordRaw: string) {
  const password = passwordInput.parse(passwordRaw);
  const record = consumeToken(token, "reset");
  const user = record.userId ? get<User>("user", SCOPE, record.userId) : null;
  if (!user) throw new ApiError(401, "invalid_link", "重設連結無效。");
  put("user", SCOPE, {
    ...user,
    passwordHash: hashPassword(password),
    emailVerified: true,
    updatedAt: nowIso(),
  });
  ensureMembership(user.id, "member");
  return issueSession(user.id);
}

export function loginWithIdentity(input: {
  provider: AuthProvider;
  providerId: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  avatarUrl?: string | null;
  mode?: "login" | "link";
  actorId?: string;
}) {
  const existing = findIdentity(input.provider, input.providerId);
  if (input.mode === "link") {
    if (!input.actorId)
      throw new ApiError(401, "sign_in_required", "請先登入再連結帳號。");
    if (existing && existing.userId !== input.actorId)
      throw new ApiError(
        409,
        "identity_taken",
        "這個登入方式已連結到其他帳號，不會因信箱相同而自動合併。",
      );
    if (!existing)
      putIdentity({
        userId: input.actorId,
        provider: input.provider,
        providerId: input.providerId,
        email: input.email,
        emailVerified: input.emailVerified,
      });
    const user = get<User>("user", SCOPE, input.actorId);
    if (!user) throw new ApiError(401, "session_expired", "請重新登入。");
    return issueSession(user.id);
  }
  if (existing) {
    ensureMembership(existing.userId, "member");
    return issueSession(existing.userId);
  }
  const user = createUser({
    name: input.name,
    email: input.email,
    avatarUrl: input.avatarUrl,
    emailVerified: input.emailVerified,
  });
  putIdentity({
    userId: user.id,
    provider: input.provider,
    providerId: input.providerId,
    email: input.email,
    emailVerified: input.emailVerified,
  });
  return issueSession(user.id);
}

export function createOAuthState(input: {
  provider: AuthProvider;
  mode: "login" | "link";
  verifier: string;
  userId?: string;
}) {
  return mintToken({
    purpose: "oauth",
    userId: input.userId || null,
    provider: input.provider,
    mode: input.mode,
    verifier: input.verifier,
    expires: Date.now() + 10 * 60_000,
  });
}

export function consumeOAuthState(token: string, provider: AuthProvider) {
  const record = consumeToken(token, "oauth");
  if (record.provider !== provider)
    throw new ApiError(401, "oauth_state", "OAuth state 無效。");
  return record;
}

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function linkEmailIdentity(
  userId: string,
  emailRaw: string,
  passwordRaw: string,
) {
  const email = emailInput.parse(emailRaw);
  const password = passwordInput.parse(passwordRaw);
  limited("link-email:" + userId, 8, 15 * 60_000);
  const existing = findIdentity("email", email);
  if (existing && existing.userId !== userId)
    throw new ApiError(
      409,
      "identity_taken",
      "這個登入方式已連結到其他帳號，不會因信箱相同而自動合併。",
    );
  if (existing)
    throw new ApiError(409, "identity_linked", "已經連結此電子信箱。");
  const user = get<User>("user", SCOPE, userId);
  if (!user) throw new ApiError(401, "session_expired", "請重新登入。");
  put("user", SCOPE, {
    ...user,
    email: user.email || email,
    passwordHash: hashPassword(password),
    updatedAt: nowIso(),
  });
  putIdentity({
    userId,
    provider: "email",
    providerId: email,
    email,
    emailVerified: false,
  });
}

export function sessionsFor(userId: string) {
  return list<AuthSession>("auth_session", SCOPE)
    .filter((row) => row.userId === userId && row.expires > Date.now())
    .map((row) => ({
      id: row.id.slice(0, 8),
      createdAt: row.createdAt,
      expiresAt: new Date(row.expires).toISOString(),
    }));
}
