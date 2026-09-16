"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type AuthUser = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  avatar: string | null;
};

export type AuthSnapshot = {
  loading: boolean;
  required: boolean;
  mode: "required" | "workspace";
  google: "available" | "unconfigured";
  tamkang: "available" | "unconfigured";
  tamkangProtocol: string | null;
  email: "available" | "unconfigured";
  magicLink: "available" | "unconfigured";
  user: AuthUser | null;
  membership: { role: string; workspaceId: string } | null;
  providers: { google: boolean; tamkang: boolean; email: boolean };
  sessionCount: number;
  sessions: Array<{ expiresAt: string }>;
  linkError: string;
  refresh: () => Promise<void>;
  logout: (all?: boolean) => Promise<void>;
};

const AuthContext = createContext<AuthSnapshot | null>(null);

export function useAuthOptional() {
  return useContext(AuthContext);
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider missing");
  return value;
}

async function redeemHashToken() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const verify = params.get("verify");
  const login = params.get("login");
  const token = verify || login;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
  const response = await fetch("/api/auth/email", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: verify ? "verify_email" : "redeem_magic",
      token,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(result.error?.message || "連結無效或已過期。");
  window.history.replaceState(null, "", window.location.pathname);
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<Omit<AuthSnapshot, "refresh" | "logout">>({
    loading: true,
    required: false,
    mode: "workspace",
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
  });

  const refresh = useCallback(async () => {
    const response = await fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json();
    setSnapshot({
      loading: false,
      required: !!data.required,
      mode: data.mode === "required" ? "required" : "workspace",
      google: data.google === "available" ? "available" : "unconfigured",
      tamkang: data.tamkang === "available" ? "available" : "unconfigured",
      tamkangProtocol: data.tamkangProtocol || null,
      email: "available",
      magicLink: data.magicLink === "available" ? "available" : "unconfigured",
      user: data.user || null,
      membership: data.membership || null,
      providers: data.providers || { google: false, tamkang: false, email: false },
      sessionCount: Number(data.sessionCount) || 0,
      sessions: Array.isArray(data.sessions)
        ? data.sessions
            .filter(
              (item: { expiresAt?: string }) =>
                typeof item?.expiresAt === "string",
            )
            .map((item: { expiresAt: string }) => ({
              expiresAt: item.expiresAt,
            }))
        : [],
      linkError: "",
    });
  }, []);

  const logout = useCallback(
    async (all = false) => {
      await fetch("/api/auth/logout", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all }),
      });
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await redeemHashToken();
        if (!cancelled) await refresh();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "連結無效或已過期。";
        if (typeof window !== "undefined") {
          const next = new URL(window.location.href);
          next.hash = "";
          next.searchParams.set("auth_error", message);
          window.history.replaceState(null, "", next.pathname + next.search);
        }
        if (!cancelled) {
          await refresh();
          setSnapshot((current) => ({ ...current, linkError: message }));
        }
      }
    })().catch(() => {
      if (!cancelled)
        setSnapshot((current) => ({
          ...current,
          loading: false,
          required: true,
        }));
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ ...snapshot, refresh, logout }),
    [snapshot, refresh, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
