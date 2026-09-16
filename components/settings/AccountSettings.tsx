"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";

type AuthSessionRow = {
  id: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  device: string;
};

const PROVIDERS = [
  { id: "google", label: "Google", href: "/api/auth/google/start" },
  { id: "tamkang", label: "淡江 SSO", href: "/api/auth/tamkang/start" },
  { id: "email", label: "電子信箱", href: "" },
] as const;

export default function AccountSettings() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [sessions, setSessions] = useState<AuthSessionRow[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkPassword, setLinkPassword] = useState("");
  const loadSessions = useCallback(async () => {
    const response = await fetch("/api/auth/sessions", { cache: "no-store" });
    if (!response.ok) {
      setSessions([]);
      return;
    }
    const body = await response.json();
    setSessions(body.sessions || []);
  }, []);
  useEffect(() => {
    if (auth?.user) void loadSessions();
  }, [auth?.user, loadSessions]);
  if (!auth?.user)
    return (
      <div className="settings-stack">
        <p className="muted">本機測試略過登入閘時，沒有帳號工作階段。</p>
      </div>
    );
  const linked = new Set(auth.user.identities);
  async function logout() {
    if (busy) return;
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }
  async function link(provider: "google" | "tamkang") {
    setNotice("");
    const response = await fetch("/api/auth/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const result = await response.json();
    if (!response.ok) {
      setNotice(result.error?.message || "無法連結。");
      return;
    }
    window.location.href = result.url;
  }
  async function attachEmail(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/auth/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          email: linkEmail,
          password: linkPassword,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "無法連結電子信箱。");
      window.location.reload();
    } catch (error) {
      setNotice((error as Error).message);
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/auth/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "無法結束工作階段。");
      setPending(null);
      await loadSessions();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const google = auth.providers.find((item) => item.id === "google");
  const tamkang = auth.providers.find((item) => item.id === "tamkang");
  return (
    <div className="settings-stack account-settings">
      <div className="account-identity">
        {auth.user.avatarUrl ? (
          <img src={auth.user.avatarUrl} alt="" width={56} height={56} />
        ) : (
          <span aria-hidden="true">
            {(auth.user.displayName || "H").slice(0, 1)}
          </span>
        )}
        <p>
          <strong>{auth.user.displayName}</strong>
          <small>{auth.user.email || "尚未連結電子信箱"}</small>
        </p>
      </div>
      <ul className="identity-list">
        <li>Google {linked.has("google") ? "✓" : "○"}</li>
        <li>淡江 SSO {linked.has("tamkang") ? "✓" : "○"}</li>
        <li>電子信箱 {linked.has("email") ? "✓" : "○"}</li>
      </ul>
      {!linked.has("google") && (
        <button
          onClick={() => void link("google")}
          disabled={!google?.configured}
        >
          {google?.configured ? "連結 Google" : "Google 登入尚未完成設定"}
        </button>
      )}
      {!linked.has("tamkang") && (
        <button
          onClick={() => void link("tamkang")}
          disabled={!tamkang?.configured}
        >
          {tamkang?.configured ? "連結淡江 SSO" : "淡江 SSO 尚未完成設定"}
        </button>
      )}
      {!linked.has("email") && (
        <form className="email-link-form" onSubmit={(event) => void attachEmail(event)}>
          <label>
            電子信箱
            <input
              type="email"
              required
              autoComplete="email"
              value={linkEmail}
              onChange={(event) => setLinkEmail(event.target.value)}
            />
          </label>
          <label>
            密碼
            <input
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={linkPassword}
              onChange={(event) => setLinkPassword(event.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            連結電子信箱
          </button>
        </form>
      )}
      {auth.membership && (
        <p className="muted">工作區角色：{auth.membership.role}</p>
      )}
      <h3>工作階段</h3>
      <ul className="session-list">
        {(sessions || []).map((item) => (
          <li key={item.id}>
            <span>
              <strong>{item.device}</strong>
              <small>
                {item.current ? "目前這個瀏覽器 · " : ""}
                {new Date(item.createdAt).toLocaleString("zh-TW")}
              </small>
            </span>
            {item.current ? (
              <span className="muted">使用中</span>
            ) : pending === item.id ? (
              <span className="session-confirm">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void revoke(item.id)}
                >
                  確定結束
                </button>
                <button disabled={busy} onClick={() => setPending(null)}>
                  取消
                </button>
              </span>
            ) : (
              <button disabled={busy} onClick={() => setPending(item.id)}>
                結束
              </button>
            )}
          </li>
        ))}
      </ul>
      {notice && <p role="status">{notice}</p>}
      <button className="primary" onClick={() => void logout()}>
        登出
      </button>
    </div>
  );
}
