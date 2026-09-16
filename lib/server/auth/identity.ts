import { randomUUID } from "node:crypto";
import { ApiError, hash, WORKSPACE_OWNER } from "../security";
import { get, list, put, transaction, deleteSession, listSessions } from "../store";

export type AuthProviderId = "google" | "tamkang" | "email";
export type MembershipRole = "owner" | "admin" | "member";

export type AuthUser = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthIdentity = {
  id: string;
  userId: string;
  provider: AuthProviderId;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatar: string | null;
  createdAt: string;
};

export type AuthMembership = {
  id: string;
  userId: string;
  workspaceId: string;
  role: MembershipRole;
  createdAt: string;
};

export type EmailCredential = {
  id: string;
  userId: string;
  passwordHash: string;
  attempts: number;
  lockedUntil: number;
};

export type AuthToken = {
  id: string;
  userId: string;
  purpose: "verify_email" | "reset_password" | "magic_link" | "oauth_state";
  expiresAt: number;
  used: boolean;
  payload?: Record<string, string>;
};

const USER = "auth_user";
const IDENTITY = "auth_identity";
const MEMBER = "auth_membership";
const CREDENTIAL = "auth_credential";
const TOKEN = "auth_token";

function now() {
  return new Date().toISOString();
}

export function identityKey(provider: AuthProviderId, subject: string) {
  return hash(provider + ":" + subject);
}

export function getUser(id: string) {
  return get<AuthUser>(USER, WORKSPACE_OWNER, id);
}

export function listUsers() {
  return list<AuthUser>(USER, WORKSPACE_OWNER);
}

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    avatar: user.avatar,
  };
}

export function findIdentity(provider: AuthProviderId, subject: string) {
  return get<AuthIdentity>(IDENTITY, WORKSPACE_OWNER, identityKey(provider, subject));
}

export function identitiesFor(userId: string) {
  return list<AuthIdentity>(IDENTITY, WORKSPACE_OWNER).filter(
    (item) => item.userId === userId,
  );
}

export function getMembership(userId: string) {
  return get<AuthMembership>(MEMBER, WORKSPACE_OWNER, userId);
}

export function getCredential(userId: string) {
  return get<EmailCredential>(CREDENTIAL, WORKSPACE_OWNER, userId);
}

export function createUser(input: {
  email?: string | null;
  emailVerified?: boolean;
  name?: string;
  avatar?: string | null;
}): AuthUser {
  const user: AuthUser = {
    id: randomUUID(),
    email: input.email || null,
    emailVerified: !!input.emailVerified,
    name: input.name || "Hermes 使用者",
    avatar: input.avatar || null,
    createdAt: now(),
    updatedAt: now(),
  };
  put(USER, WORKSPACE_OWNER, user);
  const existing = list<AuthMembership>(MEMBER, WORKSPACE_OWNER);
  const role: MembershipRole = existing.length === 0 ? "owner" : "member";
  put(MEMBER, WORKSPACE_OWNER, {
    id: user.id,
    userId: user.id,
    workspaceId: WORKSPACE_OWNER,
    role,
    createdAt: now(),
  } satisfies AuthMembership);
  return user;
}

export function saveUser(user: AuthUser) {
  put(USER, WORKSPACE_OWNER, { ...user, updatedAt: now() });
}

export function putIdentity(input: Omit<AuthIdentity, "id" | "createdAt"> & { createdAt?: string }) {
  const identity: AuthIdentity = {
    id: identityKey(input.provider, input.subject),
    userId: input.userId,
    provider: input.provider,
    subject: input.subject,
    email: input.email,
    emailVerified: input.emailVerified,
    name: input.name,
    avatar: input.avatar,
    createdAt: input.createdAt || now(),
  };
  const existing = get<AuthIdentity>(IDENTITY, WORKSPACE_OWNER, identity.id);
  if (existing && existing.userId !== input.userId)
    throw new ApiError(
      409,
      "identity_taken",
      "此登入方式已連結其他帳號。",
      "AUTH_ERROR",
    );
  put(IDENTITY, WORKSPACE_OWNER, identity);
  return identity;
}

export function linkIdentity(userId: string, input: {
  provider: AuthProviderId;
  subject: string;
  email?: string | null;
  emailVerified?: boolean;
  name?: string | null;
  avatar?: string | null;
}) {
  const current = findIdentity(input.provider, input.subject);
  if (current && current.userId !== userId)
    throw new ApiError(
      409,
      "identity_taken",
      "此登入方式已連結其他帳號，不會因電子信箱相同而自動合併。",
      "AUTH_ERROR",
    );
  if (current?.userId === userId) return current;
  return putIdentity({
    userId,
    provider: input.provider,
    subject: input.subject,
    email: input.email || null,
    emailVerified: !!input.emailVerified,
    name: input.name || null,
    avatar: input.avatar || null,
  });
}

export function putCredential(userId: string, passwordHash: string) {
  put(CREDENTIAL, WORKSPACE_OWNER, {
    id: userId,
    userId,
    passwordHash,
    attempts: 0,
    lockedUntil: 0,
  } satisfies EmailCredential);
}

export function touchCredential(record: EmailCredential) {
  put(CREDENTIAL, WORKSPACE_OWNER, record);
}

export function putAuthToken(tokenHash: string, record: Omit<AuthToken, "id">) {
  put(TOKEN, WORKSPACE_OWNER, { ...record, id: tokenHash } satisfies AuthToken);
}

export function getAuthToken(tokenHash: string) {
  return get<AuthToken>(TOKEN, WORKSPACE_OWNER, tokenHash);
}

export function consumeAuthToken(tokenHash: string) {
  return transaction(() => {
    const record = getAuthToken(tokenHash);
    if (!record || record.used || record.expiresAt <= Date.now())
      throw new ApiError(401, "invalid_link", "連結已使用、已過期或不存在。", "AUTH_ERROR");
    put(TOKEN, WORKSPACE_OWNER, { ...record, used: true });
    return record;
  });
}

export function providerStatus(userId: string) {
  const linked = new Set(identitiesFor(userId).map((item) => item.provider));
  return {
    google: linked.has("google"),
    tamkang: linked.has("tamkang"),
    email: linked.has("email"),
  };
}

export function revokeUserSessions(userId: string) {
  for (const session of listSessions(userId)) deleteSession(session.digest);
}
