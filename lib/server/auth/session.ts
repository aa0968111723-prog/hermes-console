import { createHash, randomBytes } from "node:crypto";
import {
  createSession,
  deleteSession,
  get,
  list,
  lookupSession,
  put,
  remove,
} from "../store";
import { ApiError } from "../errors";
import { getUser, membershipOf, publicUser } from "./identity";
import { providerStatus } from "./providers";
import type { PublicSession } from "../../contracts";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const AUTH_COOKIE = "hermes_auth";
const SESSION_MS = 12 * 60 * 60_000;

export function isLoopbackOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isAuthEnforced() {
  if (process.env.CONSOLE_ALLOW_LOCAL_ACCESS === "true") return false;
  return process.env.CONSOLE_AUTH_REQUIRED === "true";
}

export function authCookie(token: string, logout = false) {
  const secure = process.env.CONSOLE_ORIGIN?.startsWith("https://")
    ? "; Secure"
    : "";
  return `${AUTH_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${logout ? 0 : 43200}${secure}`;
}

export function cookieToken(request: Request, name = AUTH_COOKIE) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

export function describeUserAgent(raw: string) {
  const value = raw.replace(/[\u0000-\u001f]/g, "").slice(0, 180);
  if (/Edg\//.test(value)) return "Edge";
  if (/Chrome\//.test(value)) return "Chrome";
  if (/Firefox\//.test(value)) return "Firefox";
  if (/Safari\//.test(value) && !/Chrome/.test(value)) return "Safari";
  return "瀏覽器";
}

type SessionRecord = {
  id: string;
  createdAt: string;
  expires: number;
  device: string;
};

export function issueSession(userId: string, request?: Request) {
  const token = randomBytes(32).toString("hex");
  const digest = hash(token);
  const expires = Date.now() + SESSION_MS;
  createSession(digest, userId, expires);
  put("auth_session", userId, {
    id: digest,
    createdAt: new Date().toISOString(),
    expires,
    device: describeUserAgent(request?.headers.get("user-agent") || ""),
  });
  return token;
}

export function readSessionUser(request: Request) {
  const token = cookieToken(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const session = lookupSession(hash(token));
  if (!session || session.expires <= Date.now()) return null;
  const user = getUser(session.owner);
  if (!user || user.disabled) return null;
  return user;
}

export function requireUser(request: Request) {
  const user = readSessionUser(request);
  if (!user)
    throw new ApiError(401, "sign_in_required", "請先登入後再使用工作區。");
  return user;
}

export function requireMembership(userId: string) {
  const membership = membershipOf(userId);
  if (!membership)
    throw new ApiError(
      403,
      "membership_required",
      "已登入，但尚未加入這個工作區。",
    );
  return membership;
}

export function clearRequestSession(request: Request) {
  const token = cookieToken(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return;
  const digest = hash(token);
  const session = lookupSession(digest);
  deleteSession(digest);
  if (session) remove("auth_session", session.owner, digest);
}

export function currentSessionDigest(request: Request) {
  const token = cookieToken(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return "";
  return hash(token);
}

export function listAuthSessions(userId: string, currentDigest: string) {
  const now = Date.now();
  return list<SessionRecord>("auth_session", userId)
    .filter((item) => item.expires > now && lookupSession(item.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((item) => ({
      id: item.id,
      current: item.id === currentDigest,
      createdAt: item.createdAt,
      expiresAt: new Date(item.expires).toISOString(),
      device: item.device || "瀏覽器",
    }));
}

export function revokeAuthSession(
  userId: string,
  digest: string,
  currentDigest: string,
) {
  if (!/^[a-f0-9]{64}$/.test(digest))
    throw new ApiError(400, "invalid_input", "工作階段識別無效。");
  if (digest === currentDigest)
    throw new ApiError(400, "current_session", "目前這個瀏覽器請用登出。");
  const record = get<SessionRecord>("auth_session", userId, digest);
  if (!record) throw new ApiError(404, "session_not_found", "找不到這個工作階段。");
  deleteSession(digest);
  remove("auth_session", userId, digest);
}

export function sessionSnapshot(request: Request): PublicSession {
  const user = readSessionUser(request);
  const membership = user ? membershipOf(user.id) : null;
  return {
    required: isAuthEnforced(),
    user: user ? publicUser(user) : null,
    membership: membership ? { role: membership.role } : null,
    providers: providerStatus(),
  };
}
