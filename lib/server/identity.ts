import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ApiError,
  WORKSPACE_OWNER,
  hash,
  limited,
} from "./security";
import {
  createSession,
  deleteSession,
  get,
  list,
  put,
  readSession,
  remove,
  transaction,
} from "./store";
import { hashPassword, passwordUsable, verifyPasswordHash } from "./passwords";
import { localAuthConvenience } from "./env";

export const emailInput = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());

export type AuthProvider = "google" | "tamkang" | "email";
export type MembershipRole = "owner" | "admin" | "member";

export type UserRecord = {
  id: string;
  email: string | null;
  name: string;
  avatar: string | null;
  emailVerified: boolean;
  passwordHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IdentityRecord = {
  id: string;
  userId: string;
  provider: AuthProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatar: string | null;
  createdAt: string;
};

export type MembershipRecord = {
  id: string;
  userId: string;
  role: MembershipRole;
  createdAt: string;
};

export type PublicUser = {
  id: string;
  email: string | null;
  name: string;
  avatar: string | null;
  emailVerified: boolean;
  identities: Array<{
    provider: AuthProvider;
    email: string | null;
    linked: true;
  }>;
  membership: MembershipRole | null;
};

const USER_OWNER = "identity";
const SESSION_MS = 12 * 60 * 60_000;

function nowIso() {
  return new Date().toISOString();
}

export function parseSessionToken(request: Request) {
  const raw = request.headers.get("cookie") || "";
  const part = raw
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("hermes_session="));
  const token = part ? part.slice("hermes_session=".length) : "";
  return /^[a-f0-9]{64}$/.test(token) ? token : "";
}

export function sessionCookie(token = "", maxAge = SESSION_MS / 1000) {
  const secure = process.env.CONSOLE_ORIGIN?.startsWith("https:")
    ? "; Secure"
    : "";
  return (
    "hermes_session=" +
    token +
    "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" +
    (token ? String(maxAge) : "0") +
    secure
  );
}

export function issueSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  createSession(hash(token), userId, Date.now() + SESSION_MS);
  put("user_session", userId, {
    id: hash(token),
    createdAt: nowIso(),
    expiresAt: Date.now() + SESSION_MS,
  });
  return token;
}

export function destroySession(request: Request) {
  const token = parseSessionToken(request);
  if (token) {
    const digest = hash(token);
    const row = readSession(digest);
    deleteSession(digest);
    if (row) remove("user_session", row.owner, digest);
  }
}

export function readUser(id: string) {
  return get<UserRecord>("user", USER_OWNER, id);
}

function identitiesFor(userId: string) {
  return list<IdentityRecord>("identity", userId);
}

export function membershipFor(userId: string) {
  return get<MembershipRecord>("membership", WORKSPACE_OWNER, userId);
}

export function publicUser(user: UserRecord): PublicUser {
  const membership = membershipFor(user.id);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    emailVerified: user.emailVerified,
    identities: identitiesFor(user.id).map((item) => ({
      provider: item.provider,
      email: item.email,
      linked: true as const,
    })),
    membership: membership?.role || null,
  };
}

export function optionalUser(request: Request) {
  const token = parseSessionToken(request);
  if (!token) return null;
  const row = readSession(hash(token));
  if (!row || row.expires <= Date.now()) return null;
  return readUser(row.owner);
}

export function requireUser(request: Request) {
  const user = optionalUser(request);
  if (!user)
    throw new ApiError(401, "sign_in_required", "請先登入 Hermes。");
  return user;
}

export function requireWorkspaceUser(request: Request) {
  const user = requireUser(request);
  const membership = membershipFor(user.id);
  if (!membership)
    throw new ApiError(
      403,
      "workspace_forbidden",
      "這個帳號還沒有工作區權限。",
    );
  return { user, membership };
}

export function requireRole(
  request: Request,
  roles: MembershipRole[],
) {
  const current = requireWorkspaceUser(request);
  if (!roles.includes(current.membership.role))
    throw new ApiError(403, "admin_required", "需要工作區管理者權限。");
  return current;
}

function identityId(provider: AuthProvider, subject: string) {
  return provider + ":" + hash(subject);
}

function writeIdentity(record: IdentityRecord) {
  put("identity", record.userId, record);
  put("identity_index", record.provider, {
    id: hash(record.subject),
    userId: record.userId,
    identityId: record.id,
  });
}

export function findIdentity(provider: AuthProvider, subject: string) {
  const index = get<{ userId: string; identityId: string }>(
    "identity_index",
    provider,
    hash(subject),
  );
  if (!index) return null;
  return get<IdentityRecord>("identity", index.userId, index.identityId);
}

function grantMembership(userId: string, email: string | null) {
  const existing = membershipFor(userId);
  if (existing) return existing;
  const members = list<MembershipRecord>("membership", WORKSPACE_OWNER);
  const admins = (process.env.CONSOLE_ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const join = (process.env.CONSOLE_WORKSPACE_JOIN || "open").trim();
  let role: MembershipRole | null = null;
  if (!members.length) role = "owner";
  else if (email && admins.includes(email)) role = "admin";
  else if (join === "open") role = "member";
  if (!role) return null;
  return put("membership", WORKSPACE_OWNER, {
    id: userId,
    userId,
    role,
    createdAt: nowIso(),
  } satisfies MembershipRecord);
}

function createUser(input: {
  email: string | null;
  name: string;
  avatar?: string | null;
  emailVerified: boolean;
  passwordHash?: string | null;
}) {
  const id = randomUUID();
  const stamp = nowIso();
  return put("user", USER_OWNER, {
    id,
    email: input.email,
    name: input.name || "Hermes 使用者",
    avatar: input.avatar || null,
    emailVerified: input.emailVerified,
    passwordHash: input.passwordHash || null,
    createdAt: stamp,
    updatedAt: stamp,
  } satisfies UserRecord);
}

export function completeExternalLogin(input: {
  provider: Exclude<AuthProvider, "email">;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  avatar: string | null;
  linkUserId?: string | null;
}) {
  const existing = findIdentity(input.provider, input.subject);
  return transaction(() => {
    if (existing) {
      if (input.linkUserId && input.linkUserId !== existing.userId)
        throw new ApiError(
          409,
          "identity_conflict",
          "此登入方式已連結到其他帳號，不會因為電子信箱相同而自動合併。",
        );
      const user = readUser(existing.userId);
      if (!user)
        throw new ApiError(401, "session_expired", "帳號資料不完整，請重新登入。");
      if (input.emailVerified || user.emailVerified)
        grantMembership(user.id, input.email || user.email);
      return user;
    }
    if (input.linkUserId) {
      const user = readUser(input.linkUserId);
      if (!user)
        throw new ApiError(401, "sign_in_required", "請先登入再連結登入方式。");
      writeIdentity({
        id: identityId(input.provider, input.subject),
        userId: user.id,
        provider: input.provider,
        subject: input.subject,
        email: input.email,
        emailVerified: input.emailVerified,
        name: input.name,
        avatar: input.avatar,
        createdAt: nowIso(),
      });
      if (input.emailVerified || user.emailVerified)
        grantMembership(user.id, input.email || user.email);
      return user;
    }
    const user = createUser({
      email: input.email,
      name: input.name,
      avatar: input.avatar,
      emailVerified: input.emailVerified,
    });
    writeIdentity({
      id: identityId(input.provider, input.subject),
      userId: user.id,
      provider: input.provider,
      subject: input.subject,
      email: input.email,
      emailVerified: input.emailVerified,
      name: input.name,
      avatar: input.avatar,
      createdAt: nowIso(),
    });
    if (input.emailVerified) grantMembership(user.id, input.email);
    return user;
  });
}

export function registerEmail(input: {
  email: string;
  password: string;
  name: string;
}) {
  const email = emailInput.parse(input.email);
  if (!passwordUsable(input.password))
    throw new ApiError(400, "invalid_input", "密碼至少 12 個字元。");
  limited("register:global", 20, 15 * 60_000);
  limited("register:" + hash(email), 5, 15 * 60_000);
  if (findIdentity("email", email))
    throw new ApiError(409, "identity_conflict", "此電子信箱已有帳號，請改為登入。");
  const verified = localAuthConvenience();
  const user = createUser({
    email,
    name: input.name.trim() || email.split("@")[0],
    emailVerified: verified,
    passwordHash: hashPassword(input.password),
  });
  writeIdentity({
    id: identityId("email", email),
    userId: user.id,
    provider: "email",
    subject: email,
    email,
    emailVerified: verified,
    name: user.name,
    avatar: null,
    createdAt: nowIso(),
  });
  if (verified) grantMembership(user.id, email);
  return { user, verified };
}

export function loginEmail(emailRaw: string, password: string) {
  const email = emailInput.parse(emailRaw);
  limited("login:global", 30, 15 * 60_000);
  limited("login:" + hash(email), 8, 15 * 60_000);
  const identity = findIdentity("email", email);
  const user = identity ? readUser(identity.userId) : null;
  const ok =
    !!user?.passwordHash && verifyPasswordHash(password, user.passwordHash);
  if (!ok)
    throw new ApiError(401, "invalid_login", "電子信箱或密碼不正確。");
  if (user.emailVerified) grantMembership(user.id, user.email);
  return user;
}

export function setPassword(userId: string, password: string) {
  if (!passwordUsable(password))
    throw new ApiError(400, "invalid_input", "密碼至少 12 個字元。");
  const user = readUser(userId);
  if (!user) throw new ApiError(401, "sign_in_required", "請先登入。");
  put("user", USER_OWNER, {
    ...user,
    passwordHash: hashPassword(password),
    updatedAt: nowIso(),
  });
}

export function markEmailVerified(userId: string) {
  const user = readUser(userId);
  if (!user) return null;
  const next = put("user", USER_OWNER, {
    ...user,
    emailVerified: true,
    updatedAt: nowIso(),
  });
  for (const identity of identitiesFor(userId).filter((item) => item.provider === "email"))
    put("identity", userId, { ...identity, emailVerified: true });
  grantMembership(userId, next.email);
  return next;
}

export function putAuthToken(input: {
  type: "verify" | "reset" | "magic";
  userId: string;
  ttlMs: number;
}) {
  const token = randomBytes(32).toString("hex");
  put("auth_token", input.type, {
    id: hash(token),
    type: input.type,
    userId: input.userId,
    expires: Date.now() + input.ttlMs,
    used: false,
  });
  return token;
}

export function consumeAuthToken(
  type: "verify" | "reset" | "magic",
  token: string,
) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new ApiError(401, "invalid_link", "連結無效或已過期。");
  return transaction(() => {
    const record = get<{
      id: string;
      type: string;
      userId: string;
      expires: number;
      used: boolean;
    }>("auth_token", type, hash(token));
    if (!record || record.used || record.expires <= Date.now())
      throw new ApiError(401, "invalid_link", "連結無效或已過期。");
    put("auth_token", type, { ...record, used: true });
    return record.userId;
  });
}

export function putOAuthState(input: {
  provider: AuthProvider;
  verifier: string;
  linkUserId?: string | null;
}) {
  const state = randomBytes(24).toString("hex");
  put("oauth_state", USER_OWNER, {
    id: state,
    provider: input.provider,
    verifier: input.verifier,
    linkUserId: input.linkUserId || null,
    expires: Date.now() + 10 * 60_000,
    used: false,
  });
  return state;
}

export function consumeOAuthState(provider: AuthProvider, state: string) {
  if (!/^[a-f0-9]{32,64}$/.test(state || ""))
    throw new ApiError(401, "oauth_failed", "登入狀態無效，請重試。");
  return transaction(() => {
    const record = get<{
      id: string;
      provider: AuthProvider;
      verifier: string;
      linkUserId: string | null;
      expires: number;
      used: boolean;
    }>("oauth_state", USER_OWNER, state);
    if (
      !record ||
      record.used ||
      record.expires <= Date.now() ||
      record.provider !== provider
    )
      throw new ApiError(401, "oauth_failed", "登入狀態無效，請重試。");
    put("oauth_state", USER_OWNER, { ...record, used: true });
    return record;
  });
}

export function listSessions(userId: string, currentDigest = "") {
  return list<{ id: string; createdAt: string; expiresAt: number }>(
    "user_session",
    userId,
  ).map((row) => ({
    id: row.id.slice(0, 12),
    createdAt: row.createdAt,
    current: !!currentDigest && row.id === currentDigest,
    active: row.expiresAt > Date.now(),
  }));
}

export function seedTestOwner(input?: {
  email?: string;
  name?: string;
  password?: string;
}) {
  if (!process.env.NODE_TEST_CONTEXT)
    throw new Error("seedTestOwner is test-only");
  const email = (input?.email || "owner@test.local").toLowerCase();
  const existing = findIdentity("email", email);
  if (existing) {
    const user = readUser(existing.userId)!;
    grantMembership(user.id, email);
    const token = issueSession(user.id);
    return { user, token, cookie: sessionCookie(token) };
  }
  const user = createUser({
    email,
    name: input?.name || "Test Owner",
    emailVerified: true,
    passwordHash: hashPassword(input?.password || "test-password-12"),
  });
  writeIdentity({
    id: identityId("email", email),
    userId: user.id,
    provider: "email",
    subject: email,
    email,
    emailVerified: true,
    name: user.name,
    avatar: null,
    createdAt: nowIso(),
  });
  grantMembership(user.id, email);
  const token = issueSession(user.id);
  return { user, token, cookie: sessionCookie(token) };
}
