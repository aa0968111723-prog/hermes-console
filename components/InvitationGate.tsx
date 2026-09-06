"use client";
import { useEffect, useState } from "react";
import HermesConsole from "./HermesConsole";
export default function InvitationGate() {
  const [member, setMember] = useState<{email: string; role: string} | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [token, setToken] = useState(""), [email, setEmail] = useState(""), [notice, setNotice] = useState("");
  async function check() {
    try {
      const response = await fetch("/api/auth", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (response.ok) setMember((await response.json()).member);
      else { setMember(null); if (response.status !== 401) setNotice("存取尚未就緒，請確認邀請與部署設定。"); }
    } catch { setMember(null); setNotice("無法驗證登入，請檢查網路後重試。"); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("login") || "";
    if (value) {
      window.history.replaceState(null, "", window.location.pathname);
      if (/^[a-f0-9]{64}$/.test(value)) setToken(value);
    }
    void check();
    const timer = setInterval(() => { if (!document.hidden) void check(); }, 30_000);
    return () => clearInterval(timer);
  }, []);
  async function submit(action: "request_link" | "redeem") {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "redeem" ? { action, token } : { action, email }),
        signal: AbortSignal.timeout(20_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "無法完成登入。");
      if (action === "redeem") { setToken(""); await check(); }
      else setNotice(result.message);
    } catch (e) { setNotice((e as Error).message); }
    finally { setBusy(false); }
  }
  if (loading) return <main className="invite-entry"><p role="status">正在驗證工作區存取…</p></main>;
  if (member) return <HermesConsole member={member} onLogout={async () => {
    const response = await fetch("/api/auth", { method: "DELETE", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("登出未完成，請檢查連線後重試。");
    setMember(null); setToken("");
  }} />;
  return <main className="invite-entry"><section>
    <h1>歡迎回到 Hermes</h1>
    <p>這是電子信箱邀請制工作區，沒有公開註冊。請使用管理員邀請的信箱。</p>
    {notice && <p role="status">{notice}</p>}
    {token ? <>
      <p>按下確認才會使用一次性連結，單純開啟郵件不會消耗登入資格。</p>
      <button className="primary" disabled={busy} onClick={() => void submit("redeem")}>確認登入工作區</button>
      <button onClick={() => setToken("")}>改用其他登入連結</button>
    </> : <form onSubmit={e => { e.preventDefault(); void submit("request_link"); }}>
      <label>受邀電子信箱<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <button className="primary" disabled={busy}>{busy ? "正在提交…" : "寄送登入連結"}</button>
    </form>}
    <button disabled={busy} onClick={() => void check()}>重新檢查存取</button>
  </section></main>;
}
