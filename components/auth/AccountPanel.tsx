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
      <ul className="account-providers">
        <li>Google {auth.providers.google ? "✓" : "—"}</li>
        <li>淡江 SSO {auth.providers.tamkang ? "✓" : "—"}</li>
        <li>電子信箱 {auth.providers.email ? "✓" : "—"}</li>
      </ul>
      {auth.google === "available" && !auth.providers.google && (
        <a className="button-link" href="/api/auth/google">
          連結 Google
        </a>
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
