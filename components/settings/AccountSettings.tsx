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
  useEffect(() => {
    void fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((response) => response.json())
      .then((body: Account & { user: Account["user"] | null }) => {
        setAccount(body.user);
        setSessions(body.sessions || []);
      })
      .catch(() => setNotice("無法載入帳號。"));
  }, []);
  if (!account) return <p className="muted">{notice || "載入帳號…"}</p>;
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
                <a href={item.href}>連結</a>
              ) : (
                <span className="muted">
                  {linked ? "已連結" : "請用上方表單"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
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
