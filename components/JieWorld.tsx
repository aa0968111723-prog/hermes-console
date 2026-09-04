"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PROJECTS } from "@/lib/catalog";

type Tab = "chat" | "projects" | "settings";
type Msg = { role: "user" | "assistant"; content: string };
type Conv = { id: string; title: string; messages: Msg[] };

const URL_KEY = "hermes.apiUrl";
const KEY_KEY = "hermes.apiKey";
const CONV_KEY = "jie.convs";
const FACE_KEY = "jie.face";

const STARTERS = [
  { t: "想文案", d: "第一段可用口號" },
  { t: "做海報", d: "海報 brief 要點" },
  { t: "切分鏡", d: "把想法切成鏡頭" },
  { t: "列出專案", d: "用 GitHub 看目錄，不要回印密鑰" }
];

function loadFace(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      ctx.drawImage(img, (img.width - side) / 2, Math.max(0, (img.height - side) / 3), side, side, 0, 0, 512, 512);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.84));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export default function JieWorld() {
  const [tab, setTab] = useState<Tab>("chat");
  const [open, setOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [face, setFace] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [convs, setConvs] = useState<Conv[]>([{ id: "c1", title: "新對話", messages: [] }]);
  const [cid, setCid] = useState("c1");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setApiUrl(localStorage.getItem(URL_KEY) || "");
    setApiKey(localStorage.getItem(KEY_KEY) || "");
    setFace(localStorage.getItem(FACE_KEY) || "");
    try {
      const raw = localStorage.getItem(CONV_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Conv[];
        if (parsed.length) {
          setConvs(parsed);
          setCid(parsed[0].id);
        }
      }
    } catch {}
  }, []);
  useEffect(() => { localStorage.setItem(CONV_KEY, JSON.stringify(convs)); }, [convs]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [convs, cid, tab]);

  const ready = Boolean(apiUrl.trim() && apiKey.trim());
  const conv = useMemo(() => convs.find((c) => c.id === cid) || convs[0], [convs, cid]);
  const messages = conv?.messages || [];

  function patch(next: Msg[]) {
    setConvs((all) => all.map((c) => (c.id === cid ? { ...c, messages: next, title: c.title === "新對話" && next[0] ? next[0].content.slice(0, 18) : c.title } : c)));
  }
  function save() {
    localStorage.setItem(URL_KEY, apiUrl.trim());
    localStorage.setItem(KEY_KEY, apiKey.trim());
    setOpen(false);
    setTab("chat");
  }
  async function onFace(file?: File) {
    if (!file) return;
    const data = await loadFace(file);
    setFace(data);
    localStorage.setItem(FACE_KEY, data);
  }
  async function send(textRaw?: string) {
    const text = (textRaw ?? input).trim();
    if (!text || busy) return;
    if (!ready) { setOpen(true); setTab("settings"); return; }
    const next = [...messages, { role: "user" as const, content: text }];
    patch(next); setInput(""); setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: apiUrl, apiKey, model: "hermes-agent",
          messages: [{ role: "system", content: "你是「倢的創作小天地」裡的助手 Hermes。倢是會跑的核心小精靈。大腦是 Hermes，第一隻手是 GitHub。繁體中文、活漏短句。不要回印密鑰。不要假裝你是倢。" }, ...next]
        })
      });
      if (!res.ok || !res.body) {
        patch([...next, { role: "assistant", content: (await res.text()) || "還連不上 Hermes" }]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = ""; let buf = "";
      patch([...next, { role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n"); buf = parts.pop() || "";
        for (const line of parts) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const data = s.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try { const json = JSON.parse(data); acc += json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || ""; }
          catch { acc += data; }
          patch([...next, { role: "assistant", content: acc || "…" }]);
        }
      }
    } catch (e) {
      patch([...next, { role: "assistant", content: `連不上：${e instanceof Error ? e.message : String(e)}` }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="app">
      <div className="sky" aria-hidden>
        <i className="spark s1" /><i className="spark s2" /><i className="spark s3" /><i className="spark s4" />
        <div className="jie">{face ? <img src={face} alt="" /> : "倢"}</div>
        <i className="orb g" /><i className="orb c" /><i className="orb i" /><i className="orb d" />
      </div>
      <header className="topbar">
        <div>
          <div className="brand">倢的創作小天地</div>
          <div className="sub">{ready ? "Hermes 已連 · 隊伍就緒" : "先開圖鑑袋填網域"}</div>
        </div>
        <button className="iconbtn" onClick={() => setOpen((v) => !v)}>{open ? "關袋" : "圖鑑袋"}</button>
      </header>
      <main className="main">
        {tab === "chat" && (
          <>
            <div className="thread" ref={logRef}>
              {messages.length === 0 ? (
                <div className="empty">
                  <h1>出發前，今天跑哪條路？</h1>
                  <p>倢在跑。四顆球是隊伍幫手。</p>
                  <div className="suggestions">
                    {STARTERS.map((s) => <button key={s.t} onClick={() => send(s.t)}>{s.t}<small>{s.d}</small></button>)}
                  </div>
                </div>
              ) : (
                <div className="thread-inner">
                  {messages.map((m, i) => (
                    <div key={i} className={m.role === "user" ? "row-msg user" : "row-msg"}>
                      {m.role === "assistant" ? <div className="avatar">{face ? <img src={face} alt="" /> : "倢"}</div> : null}
                      <div className={m.role === "user" ? "bubble user" : "bubble"}>{m.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="composer-wrap">
              <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <textarea rows={1} value={input} placeholder="對話框：跟倢說…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
                <button className={busy ? "send busy" : "send"} type="submit" disabled={busy || !input.trim()}>{busy ? "…" : "▶"}</button>
              </form>
              <div className="hint">對話框 · 腦 Hermes · 手 GitHub</div>
            </div>
          </>
        )}
        {tab === "projects" && (
          <div className="thread"><div className="thread-inner sheet">
            {PROJECTS.slice(0, 16).map((p) => <article key={p.name} className="card"><h3>{p.name}</h3><p>{p.group} · {p.blurb}</p></article>)}
          </div></div>
        )}
        {tab === "settings" && (
          <div className="thread"><div className="thread-inner sheet">
            <div className="field"><label>倢的圖</label><input type="file" accept="image/*" onChange={(e) => onFace(e.target.files?.[0])} /></div>
            <div className="field"><label>根網域</label><input value={apiUrl} placeholder="https://xxxx.zeabur.app" onChange={(e) => setApiUrl(e.target.value)} /></div>
            <div className="field"><label>API Key</label><input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></div>
            <button className="primary" onClick={save}>儲存</button>
          </div></div>
        )}
      </main>
      <aside className={open ? "drawer open" : "drawer"}>
        <div className="sheet">
          <button className="card" onClick={() => { setTab("chat"); setOpen(false); }}><h3>對話</h3><p>底欄對話框</p></button>
          <button className="card" onClick={() => { const id = `c${Date.now()}`; setConvs((all) => [{ id, title: "新對話", messages: [] }, ...all]); setCid(id); setTab("chat"); setOpen(false); }}><h3>新出發</h3><p>換一條路</p></button>
          <button className="card" onClick={() => { setTab("projects"); setOpen(false); }}><h3>圖鑑袋</h3><p>GitHub 專案</p></button>
          <button className="card" onClick={() => { setTab("settings"); setOpen(false); }}><h3>設定</h3><p>圖、網域、Key</p></button>
        </div>
      </aside>
    </div>
  );
}
