import { createHash, randomBytes } from "node:crypto";
import {
  createSession,
  deleteSession,
  lookupSession,
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
  if (process.env.NODE_TEST_CONTEXT && process.env.CONSOLE_AUTH_REQUIRED !== "true")
    return false;
  return process.env.CONSOLE_AUTH_REQUIRED !== "false";
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

export function issueSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  createSession(hash(token), userId, Date.now() + SESSION_MS);
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
  if (/^[a-f0-9]{64}$/.test(token)) deleteSession(hash(token));
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
