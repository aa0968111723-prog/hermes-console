"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applySessionFetch,
  EMPTY_SESSION_VIEW,
  failClosedSession,
  type AuthUser,
  type SessionView,
} from "@/lib/client/auth-session";

export type { AuthUser };

export type AuthSnapshot = SessionView & {
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
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
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const verify = params.get("verify");
  const login = params.get("login");
  const token = verify || login;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
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
  return true;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<SessionView>(EMPTY_SESSION_VIEW);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json().catch(() => ({}));
      setSnapshot((current) => applySessionFetch(current, { ok: response.ok, data }));
    } catch {
      setSnapshot((current) => failClosedSession(current));
    }
  }, []);

  const retry = useCallback(async () => {
    setSnapshot((current) =>
      current.user ? current : { ...current, loading: true, unreachable: false },
    );
    await refresh();
  }, [refresh]);

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
    const consume = async (fromHashChange = false) => {
      try {
        const consumed = await redeemHashToken();
        if (!cancelled && (consumed || !fromHashChange)) await refresh();
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
    };
    void consume();
    const onHashChange = () => {
      void consume(true);
    };
    const onOnline = () => {
      if (snapshotRef.current.unreachable) void refresh();
    };
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ ...snapshot, refresh, retry, logout }),
    [snapshot, refresh, retry, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
