import { createHash, randomUUID } from "node:crypto";
import { get, list, put, transaction } from "../store";
import { ApiError } from "../errors";
import type {
  AuthIdentity,
  AuthProviderId,
  AuthUser,
  MembershipRole,
  WorkspaceMembership,
} from "./types";

const SCOPE = "auth";
const WORKSPACE = "workspace";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function getUser(id: string) {
  return get<AuthUser>("user", SCOPE, id);
}

export function identitiesFor(userId: string) {
  return list<AuthIdentity>("identity", SCOPE).filter((item) => item.userId === userId);
}

export function identityOf(provider: AuthProviderId, subject: string) {
  return get<AuthIdentity>("identity", SCOPE, `${provider}:${subject}`);
}

export function membershipOf(userId: string) {
  return get<WorkspaceMembership>("membership", WORKSPACE, userId);
}

export function listOwners() {
  return list<WorkspaceMembership>("membership", WORKSPACE).filter(
    (item) => item.role === "owner",
  );
}

function bootstrapRole(email: string | null): MembershipRole | null {
  const admins = (process.env.CONSOLE_ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (email && admins.includes(email.toLowerCase())) return "owner";
  if (!listOwners().length) return "owner";
  return null;
}

export function createUser(input: {
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  avatarUrl?: string | null;
  passwordHash?: string | null;
}) {
  const now = new Date().toISOString();
  const user: AuthUser = {
    id: randomUUID(),
    displayName: input.displayName.slice(0, 80) || "Hermes 使用者",
    email: input.email,
    emailVerified: input.emailVerified,
    avatarUrl: input.avatarUrl || null,
    passwordHash: input.passwordHash || null,
    createdAt: now,
    updatedAt: now,
    disabled: false,
  };
  put("user", SCOPE, user);
  const role = bootstrapRole(user.email);
  if (role) grantMembership(user.id, role);
  return user;
}

export function saveUser(user: AuthUser) {
  put("user", SCOPE, { ...user, updatedAt: new Date().toISOString() });
}

export function attachIdentity(input: {
  userId: string;
  provider: AuthProviderId;
  providerSubject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}) {
  const id = `${input.provider}:${input.providerSubject}`;
  const existing = get<AuthIdentity>("identity", SCOPE, id);
  if (existing && existing.userId !== input.userId)
    throw new ApiError(
      409,
      "identity_conflict",
      "這個登入方式已連結到另一個帳號，未自動合併。",
    );
  const identity: AuthIdentity = {
    id,
    userId: input.userId,
    provider: input.provider,
    providerSubject: input.providerSubject,
    email: input.email,
    emailVerified: input.emailVerified,
    name: input.name,
    avatarUrl: input.avatarUrl,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  put("identity", SCOPE, identity);
  return identity;
}

export function grantMembership(userId: string, role: MembershipRole) {
  const record: WorkspaceMembership = {
    id: userId,
    workspaceId: WORKSPACE,
    userId,
    role,
    createdAt: membershipOf(userId)?.createdAt || new Date().toISOString(),
  };
  put("membership", WORKSPACE, record);
  return record;
}

export function emailSubject(email: string) {
  return hash("email:" + email.trim().toLowerCase());
}

export function findUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const identity = identityOf("email", emailSubject(normalized));
  if (identity) return getUser(identity.userId);
  return (
    list<AuthUser>("user", SCOPE).find((user) => user.email === normalized) ||
    null
  );
}

export function resolveLoginIdentity(input: {
  provider: AuthProviderId;
  providerSubject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}) {
  return transaction(() => {
    const existing = identityOf(input.provider, input.providerSubject);
    if (existing) {
      const user = getUser(existing.userId);
      if (!user || user.disabled)
        throw new ApiError(401, "invalid_login", "帳號無法使用。");
      attachIdentity({ ...input, userId: user.id });
      if (input.email && !user.email) {
        saveUser({
          ...user,
          email: input.email,
          emailVerified: input.emailVerified,
          displayName: user.displayName || input.name || user.displayName,
          avatarUrl: user.avatarUrl || input.avatarUrl,
        });
      }
      return getUser(user.id)!;
    }
    // Same email on another account is NOT an automatic merge.
    const user = createUser({
      displayName: input.name || input.email || "Hermes 使用者",
      email: input.email,
      emailVerified: input.emailVerified,
      avatarUrl: input.avatarUrl,
    });
    attachIdentity({ ...input, userId: user.id });
    return user;
  });
}

export function linkIdentity(userId: string, input: {
  provider: AuthProviderId;
  providerSubject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}) {
  return transaction(() => {
    const user = getUser(userId);
    if (!user) throw new ApiError(401, "session_expired", "請重新登入。");
    attachIdentity({ ...input, userId });
    return user;
  });
}

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    avatarUrl: user.avatarUrl,
    identities: identitiesFor(user.id).map((item) => item.provider),
  };
}
