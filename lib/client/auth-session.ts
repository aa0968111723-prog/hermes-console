export type AuthUser = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  avatar: string | null;
};

export type AuthMembershipView = { role: string; workspaceId: string };

export type SessionView = {
  loading: boolean;
  unreachable: boolean;
  required: boolean;
  mode: "required" | "workspace";
  google: "available" | "unconfigured";
  tamkang: "available" | "unconfigured";
  tamkangProtocol: string | null;
  email: "available" | "unconfigured";
  magicLink: "available" | "unconfigured";
  user: AuthUser | null;
  membership: AuthMembershipView | null;
  providers: { google: boolean; tamkang: boolean; email: boolean };
  sessionCount: number;
  sessions: Array<{ expiresAt: string }>;
  linkError: string;
};

export const EMPTY_SESSION_VIEW: SessionView = {
  loading: true,
  unreachable: false,
  required: true,
  mode: "required",
  google: "unconfigured",
  tamkang: "unconfigured",
  tamkangProtocol: null,
  email: "available",
  magicLink: "unconfigured",
  user: null,
  membership: null,
  providers: { google: false, tamkang: false, email: false },
  sessionCount: 0,
  sessions: [],
  linkError: "",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asUser(value: unknown): AuthUser | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string" || !row.id) return null;
  return {
    id: row.id,
    email: typeof row.email === "string" ? row.email : null,
    emailVerified: !!row.emailVerified,
    name: typeof row.name === "string" && row.name ? row.name : "Hermes 使用者",
    avatar: typeof row.avatar === "string" ? row.avatar : null,
  };
}

function asMembership(value: unknown): AuthMembershipView | null {
  const row = asRecord(value);
  if (!row || typeof row.role !== "string" || typeof row.workspaceId !== "string")
    return null;
  return { role: row.role, workspaceId: row.workspaceId };
}

export function isUsableSessionPayload(data: unknown): boolean {
  const row = asRecord(data);
  if (!row || row.error) return false;
  return row.mode === "required" || row.mode === "workspace";
}

export function failClosedSession(current: SessionView): SessionView {
  if (current.user) {
    return { ...current, loading: false, unreachable: true };
  }
  return {
    ...current,
    loading: false,
    unreachable: true,
    required: true,
    mode: "required",
    user: null,
    membership: null,
  };
}

export function sessionViewFromPayload(data: unknown): SessionView | null {
  if (!isUsableSessionPayload(data)) return null;
  const row = asRecord(data)!;
  const user = asUser(row.user);
  const providers = asRecord(row.providers);
  return {
    loading: false,
    unreachable: false,
    required: row.mode !== "workspace",
    mode: row.mode === "workspace" ? "workspace" : "required",
    google: row.google === "available" ? "available" : "unconfigured",
    tamkang: row.tamkang === "available" ? "available" : "unconfigured",
    tamkangProtocol:
      typeof row.tamkangProtocol === "string" ? row.tamkangProtocol : null,
    email: "available",
    magicLink: row.magicLink === "available" ? "available" : "unconfigured",
    user,
    membership: user ? asMembership(row.membership) : null,
    providers: {
      google: !!providers?.google,
      tamkang: !!providers?.tamkang,
      email: !!providers?.email,
    },
    sessionCount: Number(row.sessionCount) || 0,
    sessions: Array.isArray(row.sessions)
      ? row.sessions
          .map((item) => asRecord(item))
          .filter((item): item is Record<string, unknown> => !!item)
          .filter((item) => typeof item.expiresAt === "string")
          .map((item) => ({ expiresAt: item.expiresAt as string }))
      : [],
    linkError: "",
  };
}

export function applySessionFetch(
  current: SessionView,
  result: { ok: boolean; data: unknown },
): SessionView {
  if (!result.ok) return failClosedSession(current);
  return sessionViewFromPayload(result.data) || failClosedSession(current);
}
