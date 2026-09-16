"use client";
import { useEffect, useState } from "react";

type Account = {
  user: {
    name: string;
    email: string | null;
    avatar: string | null;
    emailVerified: boolean;
    identities: Array<{ provider: string; email: string | null }>;
    membership: string | null;
  };
  sessions: Array<{
    id: string;
    createdAt: string;
    current: boolean;
    active: boolean;
  }>;
};

const PROVIDERS = [
  { id: "google", label: "Google", href: "/api/auth/google/start" },
  { id: "tamkang", label: "淡江 SSO", href: "/api/auth/tamkang/start" },
  { id: "email", label: "電子信箱", href: "" },
] as const;

export default function AccountSettings() {
  const [account, setAccount] = useState<Account["user"] | null>(null);
  const [sessions, setSessions] = useState<Account["sessions"]>([]);
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = (await response.json()) as Account & {
      user: Account["user"] | null;
    };
    setAccount(body.user);
    setSessions(body.sessions || []);
  }
  useEffect(() => {
    void load().catch(() => setNotice("無法載入帳號。"));
  }, []);
  if (!account) return <p className="muted">{notice || "載入帳號…"}</p>;
  const emailLinked = account.identities.some((row) => row.provider === "email");
  return (
    <div className="settings-stack account-settings">
      <div className="account-card">
        {account.avatar ? (
          <img src={account.avatar} alt="" width={56} height={56} />
        ) : (
          <span className="account-avatar" aria-hidden="true">
            {account.name.slice(0, 1)}
          </span>
        )}
        <div>
          <strong>{account.name}</strong>
          <p>{account.email || "尚未連結電子信箱"}</p>
          <p className="muted">
            工作區角色：{account.membership || "尚未加入"}
          </p>
        </div>
      </div>
      <h3>登入方式</h3>
      <ul className="identity-list">
        {PROVIDERS.map((item) => {
          const linked = account.identities.some(
            (row) => row.provider === item.id,
          );
          return (
            <li key={item.id}>
              <span>
                {item.label}
                {linked ? " ✓" : ""}
              </span>
              {!linked && item.href ? (
                <a className="text-button" href={item.href}>
                  連結
                </a>
              ) : (
                <span className="muted">
                  {linked ? "已連結" : "用下方表單"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!emailLinked && (
        <form
          className="account-link-email"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setNotice("");
            try {
              const response = await fetch("/api/auth/email", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "link",
                  email,
                  password,
                }),
              });
              const body = (await response.json()) as {
                message?: string;
                error?: { message?: string };
              };
              if (!response.ok)
                throw new Error(body.error?.message || "連結失敗。");
              setPassword("");
              setNotice(body.message || "已連結電子信箱。");
              await load();
            } catch (error) {
              setNotice((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            連結電子信箱
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            密碼
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            連結
          </button>
        </form>
      )}
      {notice ? <p role="status">{notice}</p> : null}
      <p className="muted">不會只因為電子信箱相同就自動合併帳號。</p>
      <h3>工作階段</h3>
      <ul className="identity-list">
        {sessions
          .filter((row) => row.active)
          .map((row) => (
            <li key={row.id}>
              <span>
                {row.current ? "目前裝置" : "其他裝置"} · {row.id}
              </span>
              <span className="muted">
                {new Date(row.createdAt).toLocaleString("zh-TW")}
              </span>
            </li>
          ))}
      </ul>
      <button
        className="primary"
        onClick={async () => {
          await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          window.location.reload();
        }}
      >
        登出
      </button>
    </div>
  );
}
