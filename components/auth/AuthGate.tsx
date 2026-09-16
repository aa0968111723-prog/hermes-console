"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import HermesConsole from "@/components/HermesConsole";
import { AuthProvider } from "./AuthProvider";
import LoginScreen from "./LoginScreen";
import type { PublicSession } from "@/lib/contracts";

const OPEN_SESSION: PublicSession = {
  required: false,
  user: null,
  membership: null,
  providers: [],
};

function subscribeHash(onStoreChange: () => void) {
  window.addEventListener("hashchange", onStoreChange);
  return () => window.removeEventListener("hashchange", onStoreChange);
}

function resetTokenFromLocation() {
  const reset = new URLSearchParams(window.location.hash.slice(1)).get("reset");
  if (reset && /^[a-f0-9]{64}$/.test(reset)) return reset;
  try {
    const stored = sessionStorage.getItem("hermes_reset_token");
    if (stored && /^[a-f0-9]{64}$/.test(stored)) return stored;
  } catch {
    /* storage may be denied */
  }
  return null;
}

function noResetToken() {
  return null;
}

function clearResetLocation() {
  try {
    sessionStorage.removeItem("hermes_reset_token");
  } catch {
    /* storage may be denied */
  }
  if (window.location.hash)
    window.history.replaceState(null, "", window.location.pathname);
  window.dispatchEvent(new Event("hashchange"));
}

export default function AuthGate() {
  const [session, setSession] = useState<PublicSession>(OPEN_SESSION);
  const [notice, setNotice] = useState("");
  const resetToken = useSyncExternalStore(
    subscribeHash,
    resetTokenFromLocation,
    noResetToken,
  );
  async function load() {
    try {
      const response = await fetch("/api/auth/session", {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        setSession(OPEN_SESSION);
        return;
      }
      setSession(await response.json());
    } catch {
      setSession(OPEN_SESSION);
    }
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "failed") {
      setNotice("登入未完成，沒有假裝成功。");
      window.history.replaceState(null, "", window.location.pathname);
    }
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const login = hash.get("login");
    const verify = hash.get("verify");
    const reset = hash.get("reset");
    if (reset && /^[a-f0-9]{64}$/.test(reset)) {
      try {
        sessionStorage.setItem("hermes_reset_token", reset);
      } catch {
        /* storage may be denied */
      }
    } else if (reset) {
      setNotice("重設連結無效或已使用。");
    }
    if (login || verify)
      window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      try {
        if (login || verify) {
          const response = await fetch("/api/auth/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: verify ? "verify" : "redeem",
              token: login || verify,
            }),
          });
          if (!response.ok) {
            const invite = await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "redeem",
                token: login || verify,
              }),
            });
            if (!invite.ok) setNotice("登入連結無效或已使用。");
          }
        }
        await load();
      } catch {
        setSession(OPEN_SESSION);
      }
    })();
  }, []);
  if (resetToken)
    return (
      <LoginScreen
        providers={session.providers}
        notice={notice}
        resetToken={resetToken}
        onSignedIn={() => {
          clearResetLocation();
          void load();
        }}
        onAbandonReset={() => {
          clearResetLocation();
        }}
      />
    );
  if (session.required && !session.user)
    return (
      <LoginScreen
        providers={session.providers}
        notice={notice}
        onSignedIn={() => void load()}
      />
    );
  if (session.required && session.user && !session.membership)
    return (
      <main className="auth-gate">
        <section className="auth-card">
          <h1>尚未加入工作區</h1>
          <p>已登入，但這個帳號還沒有工作區權限。</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void fetch("/api/auth/logout", { method: "POST" }).then(() =>
                load(),
              );
            }}
          >
            <button className="primary">登出</button>
          </form>
        </section>
      </main>
    );
  return (
    <AuthProvider value={session}>
      <HermesConsole />
    </AuthProvider>
  );
}
