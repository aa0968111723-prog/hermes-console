"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";

export default function AccountPanel() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  if (!auth.required) {
    return (
      <div className="settings-stack">
        <h3>帳號</h3>
        <p className="muted">工作區模式。正式環境請設 CONSOLE_AUTH_MODE=required。</p>
      </div>
    );
  }
  if (!auth.user) return null;

  async function resendVerify() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/auth/email", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend_verify" }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "無法寄出。");
      setNotice(result.message || "若寄信已設定，系統將寄出驗證信。");
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function linkEmail() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/auth/email", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link_email", email, password }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "無法連結。");
      await auth.refresh();
      setNotice("已連結電子信箱。");
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-stack">
      <h3>帳號</h3>
      <div className="account-card">
        {auth.user.avatar ? (
          <img src={auth.user.avatar} alt="" width={48} height={48} />
        ) : (
          <span className="account-avatar" aria-hidden="true">
            {auth.user.name.slice(0, 1)}
          </span>
        )}
        <div>
          <strong>{auth.user.name}</strong>
          <p>{auth.user.email || "尚未連結電子信箱"}</p>
          <p className="muted">{auth.membership?.role}</p>
        </div>
      </div>
      <ul className="account-identities" aria-label="登入方式">
        <li data-linked={auth.providers.google ? "true" : "false"}>
          <span
            className="connection-state"
            data-state={
              auth.providers.google
                ? "verified"
                : auth.google === "available"
                  ? "unconfigured"
                  : "unknown"
            }
          >
            <i aria-hidden="true" />
          </span>
          <strong>Google</strong>
          <span>{auth.providers.google ? "✓" : "○"}</span>
        </li>
        <li data-linked={auth.providers.tamkang ? "true" : "false"}>
          <span
            className="connection-state"
            data-state={
              auth.providers.tamkang
                ? "verified"
                : auth.tamkang === "available"
                  ? "unconfigured"
                  : "unknown"
            }
          >
            <i aria-hidden="true" />
          </span>
          <strong>淡江 SSO</strong>
          <span>{auth.providers.tamkang ? "✓" : "○"}</span>
        </li>
        <li data-linked={auth.providers.email ? "true" : "false"}>
          <span
            className="connection-state"
            data-state={
              auth.providers.email
                ? auth.user.emailVerified
                  ? "verified"
                  : "partial"
                : "unconfigured"
            }
          >
            <i aria-hidden="true" />
          </span>
          <strong>電子信箱</strong>
          <span>{auth.providers.email ? "✓" : "○"}</span>
        </li>
      </ul>
      <p className="muted">
        {auth.user.emailVerified ? "電子信箱已驗證" : "電子信箱未驗證"}
      </p>
      {!auth.user.emailVerified && auth.user.email && (
        <button type="button" disabled={busy} onClick={() => void resendVerify()}>
          重寄驗證信
        </button>
      )}
      {auth.google === "available" && !auth.providers.google && (
        <a className="button-link" href="/api/auth/google">
          連結 Google
        </a>
      )}
      {auth.google !== "available" && (
        <p className="muted">Google 尚未完成設定</p>
      )}
      {auth.tamkang === "available" && !auth.providers.tamkang ? (
        <a className="button-link" href="/api/auth/tamkang">
          連結淡江 SSO
        </a>
      ) : auth.tamkang !== "available" ? (
        <p className="muted">淡江 SSO 尚未完成設定</p>
      ) : null}
      {!auth.providers.email && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void linkEmail();
          }}
        >
          <label>
            連結電子信箱
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            設定密碼
            <input
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            連結
          </button>
        </form>
      )}
      <p className="muted">工作階段 {auth.sessionCount || 1}</p>
      {auth.sessions.length > 0 && (
        <ul className="account-sessions">
          {auth.sessions.map((item) => (
            <li key={item.expiresAt}>
              至 {new Date(item.expiresAt).toLocaleString("zh-TW")}
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <p role="alert" className={notice.startsWith("已") ? "muted" : "error"}>
          {notice}
        </p>
      )}
      <button type="button" onClick={() => void auth.logout()}>
        登出
      </button>
      <button type="button" onClick={() => void auth.logout(true)}>
        登出所有工作階段
      </button>
    </div>
  );
}
