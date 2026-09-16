"use client";
import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";

export default function AccountSettings() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
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
        <button onClick={() => void link("google")}>連結 Google</button>
      )}
      {!linked.has("tamkang") && (
        <button
          onClick={() => void link("tamkang")}
          disabled={!tamkang?.configured}
        >
          {tamkang?.configured ? "連結淡江 SSO" : "淡江 SSO 尚未完成設定"}
        </button>
      )}
      <p className="muted">
        目前工作階段約 12 小時有效。登出只結束這個瀏覽器，不會列出其他裝置。
      </p>
      {auth.membership && (
        <p className="muted">工作區角色：{auth.membership.role}</p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button className="primary" onClick={() => void logout()}>
        登出
      </button>
    </div>
  );
}
