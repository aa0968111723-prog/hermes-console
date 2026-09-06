"use client";
import { useEffect, useState } from "react";
import type { Member } from "@/lib/server/invitations";
export default function MemberAccess({ member, onLogout }: {
  member: {email: string; role: string}; onLogout: () => Promise<void>;
}) {
  const [members, setMembers] = useState<Member[]>([]), [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  async function load() {
    const response = await fetch("/api/invitations", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "無法取得成員。");
    setMembers(result.members);
  }
  useEffect(() => { if (member.role === "admin") void load().catch(e => setNotice(e.message)); }, [member.role]);
  async function change(method: string, body: unknown) {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/invitations", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "操作失敗。");
      setNotice(result.notice || "存取已撤銷，現有登入連結與會話已失效。");
      await load();
    } catch (e) { setNotice((e as Error).message); await load().catch(() => {}); }
    finally { setBusy(false); }
  }
  return <section className="workbench" aria-label="成員存取">
    <h3>成員與存取</h3><p>{member.email} · {member.role === "admin" ? "管理員" : "受邀成員"}</p>
    <p>邀請成員會授予共用工作區的對話、素材與學習資料存取權。</p>
    <button disabled={busy} onClick={async () => {
      setBusy(true); setNotice("");
      try { await onLogout(); } catch { setNotice("登出未完成，請檢查連線後重試。"); }
      finally { setBusy(false); }
    }}>登出此裝置</button>
    {notice && <p role="status">{notice}</p>}
    {member.role === "admin" && <>
      <form onSubmit={e => { e.preventDefault(); void change("POST", { email }); }}>
        <label>邀請電子信箱<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <button disabled={busy}>發送邀請</button>
      </form>
      <ul>{members.map(m => <li key={m.id}>
        <p>{m.email} · {m.active ? "可存取" : "已撤銷"} · 寄信：{({not_sent: "未寄出", accepted: "服務已接受（非送達證據）", failed: "失敗"})[m.delivery]}</p>
        {m.role !== "admin" && m.active && <button disabled={busy} onClick={() => {
          if (window.confirm("撤銷此成員的工作區存取？其登入連結與會話將立即失效。"))
            void change("DELETE", { id: m.id });
        }}>撤銷存取</button>}
      </li>)}</ul>
    </>}
  </section>;
}
