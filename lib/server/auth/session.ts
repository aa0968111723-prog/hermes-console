import { randomBytes } from "node:crypto";
import {
  ApiError,
  hash,
  sessionCookie,
} from "../security";
import { createSession, deleteSession, listSessions, readSession } from "../store";
import {
  getMembership,
  getUser,
  publicUser,
  identitiesFor,
  providerStatus,
  type AuthMembership,
  type AuthUser,
} from "./identity";

const COOKIE = "hermes_session=";

export function sessionTokenFrom(request: Request) {
  const token =
    (request.headers.get("cookie") || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(COOKIE))
      ?.slice(COOKIE.length) || "";
  return /^[a-f0-9]{64}$/.test(token) ? token : "";
}

export function issueSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  createSession(hash(token), userId, Date.now() + 12 * 60 * 60_000);
  return { token, header: sessionCookie(token) };
}

export function clearSession(request: Request) {
  const token = sessionTokenFrom(request);
  if (token) deleteSession(hash(token));
  return sessionCookie(token, true);
}

export function readAccess(request: Request): {
  user: AuthUser;
  membership: AuthMembership;
} | null {
  const token = sessionTokenFrom(request);
  if (!token) return null;
  const session = readSession(hash(token));
  if (!session || session.expires <= Date.now()) return null;
  const user = getUser(session.owner);
  const membership = getMembership(session.owner);
  if (!user || !membership) return null;
  return { user, membership };
}

export function requireAccess(request: Request) {
  const access = readAccess(request);
  if (!access)
    throw new ApiError(401, "AUTH_ERROR", "請先登入 Hermes。", "AUTH_ERROR");
  return access;
}

export function requireRole(
  membership: AuthMembership,
  roles: AuthMembership["role"][],
) {
  if (!roles.includes(membership.role))
    throw new ApiError(403, "PERMISSION_ERROR", "沒有權限執行此操作。", "PERMISSION_ERROR");
  return membership;
}

export function sessionPayload(user: AuthUser, membership: AuthMembership) {
  return {
    user: publicUser(user),
    membership: { role: membership.role, workspaceId: membership.workspaceId },
    identities: identitiesFor(user.id).map((item) => ({
      provider: item.provider,
      email: item.email,
      linked: true,
    })),
    providers: providerStatus(user.id),
    sessionCount: listSessions(user.id).length,
    sessions: listSessions(user.id).map((item) => ({
      expiresAt: new Date(item.expires).toISOString(),
    })),
  };
}
