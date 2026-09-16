"use client";
import { useState } from "react";
import type { PublicProviderStatus } from "@/lib/contracts";

export default function LoginScreen({
  providers,
  notice,
  onSignedIn,
}: {
  providers: PublicProviderStatus[];
  notice?: string;
  onSignedIn: () => void;
}) {
  const google = providers.find((item) => item.id === "google");
  const tamkang = providers.find((item) => item.id === "tamkang");
  const email = providers.find((item) => item.id === "email");
  const [mode, setMode] = useState<"login" | "register" | "magic" | "forgot">(
    "login",
  );
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(notice || "");
  async function submit(action: string, extra: Record<string, string> = {}) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email: address, ...extra }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "無法完成登入。");
      if (result.signedIn) onSignedIn();
      else setMessage(result.message || "請查看信箱。");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-gate">
      <section className="auth-card">
        <img
          className="auth-turtle"
          src="/mascot/turtle.png"
          alt="Hermes 龜龜"
          width={120}
          height={120}
        />
        <h1>登入 Hermes</h1>
        {message && (
          <p role="status" className="auth-notice">
            {message}
          </p>
        )}
        {google?.configured ? (
          <a className="auth-provider" href="/api/auth/google">
            Google
            <small>使用 Google 帳號</small>
          </a>
        ) : (
          <button type="button" className="auth-provider" disabled>
            Google
            <small>{google?.message || "Google 登入尚未完成設定"}</small>
          </button>
        )}
        {tamkang?.configured ? (
          <a className="auth-provider" href="/api/auth/tamkang">
            淡江 SSO
            <small>前往淡江身分服務</small>
          </a>
        ) : (
          <button type="button" className="auth-provider" disabled>
            淡江 SSO
            <small>{tamkang?.message || "淡江 SSO 尚未完成設定"}</small>
          </button>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === "login")
              void submit("login", { password });
            else if (mode === "register")
              void submit("register", { password, name });
            else if (mode === "magic") void submit("magic_link");
            else void submit("forgot");
          }}
        >
          {mode === "register" && (
            <label>
              名稱
              <input
                value={name}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          <label>
            電子信箱
            <input
              type="email"
              required
              autoComplete="email"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </label>
          {(mode === "login" || mode === "register") && (
            <label>
              密碼
              <input
                type="password"
                required
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          <button className="primary" disabled={busy}>
            {mode === "login"
              ? "登入"
              : mode === "register"
                ? "建立帳號"
                : mode === "magic"
                  ? "寄送登入連結"
                  : "寄送重設連結"}
          </button>
        </form>
        <div className="auth-links">
          <button type="button" className="text-button" onClick={() => setMode("login")}>
            密碼登入
          </button>
          <button type="button" className="text-button" onClick={() => setMode("register")}>
            建立帳號
          </button>
          <button type="button" className="text-button" onClick={() => setMode("magic")}>
            登入連結
          </button>
          <button type="button" className="text-button" onClick={() => setMode("forgot")}>
            忘記密碼
          </button>
        </div>
        {!email?.configured && (
          <p className="quiet">{email?.message}</p>
        )}
      </section>
    </main>
  );
}
