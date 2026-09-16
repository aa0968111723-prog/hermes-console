"use client";
import { useState } from "react";
import { useAuth } from "./AuthProvider";

export default function AccountMenu() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  if (!auth?.user) return null;
  const linked = new Set(auth.user.identities);
  const google = auth.providers.find((item) => item.id === "google");
  const tamkang = auth.providers.find((item) => item.id === "tamkang");
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
  return (
    <div className="account-menu">
      <button
        className="icon-button account-avatar"
        aria-label="帳號"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {auth.user.avatarUrl ? (
          <img src={auth.user.avatarUrl} alt="" width={36} height={36} />
        ) : (
          <span aria-hidden="true">
            {(auth.user.displayName || "H").slice(0, 1)}
          </span>
        )}
      </button>
      {open && (
        <div className="account-panel" role="dialog" aria-label="帳號">
          <p>
            <strong>{auth.user.displayName}</strong>
            <small>{auth.user.email || "尚未連結電子信箱"}</small>
          </p>
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
          {notice && <p role="status">{notice}</p>}
          <button className="primary" onClick={() => void logout()}>
            登出
          </button>
        </div>
      )}
    </div>
  );
}
