"use client";

import { useEffect, useState, type FormEvent } from "react";

type Identity = {
  provider: "google" | "tamkang" | "email";
  email: string | null;
  emailVerified: boolean;
};

type Account = {
  user: {
    id: string;
    name: string;
    email: string | null;
    avatarUrl: string | null;
    emailVerified: boolean;
  };
  membership: { role: string } | null;
  identities: Identity[];
  sessions: { id: string; createdAt: string; expiresAt: string }[];
  providers: {
    google: { configured: boolean; label: string };
    tamkang: { configured: boolean; label: string };
    email: { configured: boolean; mail: boolean; label: string };
  };
};

export default function AccountSettings() {
  const [account, setAccount] = useState<Account | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/auth", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.ok) setAccount(await response.json());
  }

  useEffect(() => {
    void load();
  }, []);

  const has = (provider: Identity["provider"]) =>
    account?.identities.some((row) => row.provider === provider);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      window.location.assign("/");
    } finally {
      setBusy(false);
    }
  }

  async function linkEmail(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link_email", email, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "無法連結。");
      setNotice("已連結電子信箱。");
      setPassword("");
      await load();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!account) return <p className="muted">讀取帳號…</p>;

  return (
    <div className="settings-stack account-settings">
      <div className="account-card">
        {account.user.avatarUrl ? (
          <img src={account.user.avatarUrl} alt="" width={56} height={56} />
        ) : (
          <span className="account-avatar" aria-hidden="true">
            {(account.user.name || "?").slice(0, 1)}
          </span>
        )}
        <div>
          <strong>{account.user.name}</strong>
          <p>{account.user.email || "尚未連結電子信箱"}</p>
          <p className="muted">
            {account.membership?.role === "owner"
              ? "工作區擁有者"
              : account.membership?.role === "admin"
                ? "管理者"
                : "成員"}
          </p>
        </div>
      </div>
      {notice && (
        <p className="error" role="alert">
          {notice}
        </p>
      )}
      <ul className="identity-list">
        <li>
          <span>Google</span>
          <span>{has("google") ? "已連結" : "未連結"}</span>
          {!has("google") &&
            (account.providers.google.configured ? (
              <a href="/api/auth/google?mode=link">連結</a>
            ) : (
              <small>{account.providers.google.label}</small>
            ))}
        </li>
        <li>
          <span>淡江 SSO</span>
          <span>{has("tamkang") ? "已連結" : "未連結"}</span>
          {!has("tamkang") &&
            (account.providers.tamkang.configured ? (
              <a href="/api/auth/tamkang?mode=link">連結</a>
            ) : (
              <small>{account.providers.tamkang.label}</small>
            ))}
        </li>
        <li>
          <span>電子信箱</span>
          <span>{has("email") ? "已連結" : "未連結"}</span>
        </li>
      </ul>
      {!has("email") && (
        <form onSubmit={(event) => void linkEmail(event)}>
          <label>
            連結電子信箱
            <input
              type="email"
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            設定密碼
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            連結信箱
          </button>
        </form>
      )}
      <h3>工作階段</h3>
      <ul className="session-list">
        {account.sessions.map((row) => (
          <li key={row.id}>
            {new Date(row.createdAt).toLocaleString("zh-TW")}
            <span className="muted">
              {" "}
              · 至 {new Date(row.expiresAt).toLocaleString("zh-TW")}
            </span>
          </li>
        ))}
      </ul>
      <button onClick={() => void logout()} disabled={busy}>
        登出
      </button>
    </div>
  );
}
