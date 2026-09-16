"use client";
import { useEffect, useState } from "react";
import HermesConsole from "@/components/HermesConsole";
import { AuthProvider } from "./AuthProvider";
import LoginScreen from "./LoginScreen";
import type { PublicSession } from "@/lib/contracts";

export default function AuthGate() {
  const [session, setSession] = useState<PublicSession | null>(null);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState("");
  const [resetToken, setResetToken] = useState<string | null>(null);
  async function load() {
    const response = await fetch("/api/auth/session", {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("無法確認登入狀態。");
    setSession(await response.json());
  }
  useEffect(() => {
    function takeHash() {
      const params = new URLSearchParams(window.location.search);
      if (params.get("auth") === "failed") {
        setNotice("登入未完成，沒有假裝成功。");
        window.history.replaceState(null, "", window.location.pathname);
      }
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const login = hash.get("login");
      const verify = hash.get("verify");
      const reset = hash.get("reset");
      if (login || verify || reset)
        window.history.replaceState(null, "", window.location.pathname);
      return { login, verify, reset };
    }
    function applyReset(reset: string | null) {
      if (!reset) return;
      if (/^[a-f0-9]{64}$/.test(reset)) setResetToken(reset);
      else setNotice("重設連結無效或已使用。");
    }
    const boot = takeHash();
    applyReset(boot.reset);
    void (async () => {
      try {
        if (boot.login || boot.verify) {
          const response = await fetch("/api/auth/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: boot.verify ? "verify" : "redeem",
              token: boot.login || boot.verify,
            }),
          });
          if (!response.ok) {
            const invite = await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "redeem",
                token: boot.login || boot.verify,
              }),
            });
            if (!invite.ok) setNotice("登入連結無效或已使用。");
          }
        }
        await load();
      } catch {
        setFailed("無法確認登入狀態。");
      }
    })();
    function onHashChange() {
      applyReset(takeHash().reset);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  if (failed)
    return (
      <main className="workspace-loading">
        <p role="alert">{failed}</p>
      </main>
    );
  if (!session)
    return (
      <main className="workspace-loading">
        <p role="status">正在確認身分…</p>
      </main>
    );
  if (resetToken)
    return (
      <LoginScreen
        providers={session.providers}
        notice={notice}
        resetToken={resetToken}
        onSignedIn={() => {
          setResetToken(null);
          void load();
        }}
        onAbandonReset={() => setResetToken(null)}
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
