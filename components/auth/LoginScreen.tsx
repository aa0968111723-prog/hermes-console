"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

export default function LoginScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"enter" | "create" | "magic" | "reset">(
    "enter",
  );
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const error =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("auth_error")
      : "";

  useEffect(() => {
    const token = new URLSearchParams(
      window.location.hash.replace(/^#/, ""),
    ).get("reset");
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      setResetToken(token);
      setMode("reset");
    }
  }, []);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const body =
        mode === "magic"
          ? { action: "magic_link", email }
          : mode === "reset"
            ? { action: "reset", token: resetToken, password }
            : {
                action: mode === "create" ? "register" : "login",
                email,
                password,
              };
      const response = await fetch("/api/auth/email", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "無法完成。");
      if (typeof window !== "undefined")
        window.history.replaceState(null, "", window.location.pathname);
      if (mode === "magic") {
        setNotice(result.message || "若此信箱已註冊，系統將寄出登入連結。");
        return;
      }
      await auth.refresh();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (busy || !email) {
      setNotice("請先填寫電子信箱。");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/auth/email", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "forgot", email }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "無法完成。");
      setNotice(result.message || "若此信箱已註冊，系統將寄出重設連結。");
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <img
          className="login-turtle"
          src="/mascot/turtle.png"
          alt="Hermes 龜龜"
        />
        <h1>Hermes</h1>
        {(error || notice) && (
          <p role="alert" className="error">
            {error || notice}
          </p>
        )}
        <div className="login-providers">
          {auth.google === "available" ? (
            <a className="primary" href="/api/auth/google">
              Google
            </a>
          ) : (
            <button type="button" disabled>
              Google 尚未完成設定
            </button>
          )}
          {auth.tamkang === "available" ? (
            <a className="primary" href="/api/auth/tamkang">
              淡江 SSO
            </a>
          ) : (
            <button type="button" disabled>
              淡江 SSO 尚未完成設定
            </button>
          )}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {mode !== "reset" && (
            <label htmlFor="login-email">
              電子信箱
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          )}
          {mode !== "magic" && (
            <label htmlFor="login-password">
              密碼
              <input
                id="login-password"
                type="password"
                required
                minLength={10}
                autoComplete={
                  mode === "create" || mode === "reset"
                    ? "new-password"
                    : "current-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? "處理中…"
              : mode === "create"
                ? "建立帳號"
                : mode === "magic"
                  ? "寄送登入連結"
                  : mode === "reset"
                    ? "重設密碼"
                    : "進入工作區"}
          </button>
        </form>
        {mode !== "reset" && (
          <div className="login-alt">
            <button
              type="button"
              className="text-button"
              onClick={() => setMode(mode === "create" ? "enter" : "create")}
            >
              {mode === "create" ? "已有帳號" : "建立電子信箱帳號"}
            </button>
            {auth.magicLink === "available" && (
              <>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setMode(mode === "magic" ? "enter" : "magic")}
                >
                  {mode === "magic" ? "改用密碼" : "Magic Link"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void forgot()}
                >
                  忘記密碼
                </button>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
