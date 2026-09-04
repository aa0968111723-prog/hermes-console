"use client";

import { useEffect, useMemo, useState } from "react";
import { PROJECTS, TOOLS } from "@/lib/catalog";

type Tab = "chat" | "projects" | "tools" | "settings";
type Msg = { role: "user" | "assistant"; content: string };

const KEY_URL = "hermes.apiUrl";
const KEY_KEY = "hermes.apiKey";

export default function Page() {
  const [tab, setTab] = useState<Tab>("chat");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState("ai_os");
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "駐駛艙已啟動。到設定填 Hermes API 網域與 Key 後就能聊天。" }
  ]);

  useEffect(() => {
    setApiUrl(localStorage.getItem(KEY_URL) || "");
    setApiKey(localStorage.getItem(KEY_KEY) || "");
  }, []);

  const ready = Boolean(apiUrl.trim() && apiKey.trim());
  const groups = useMemo(() => {
    const map = new Map<string, typeof PROJECTS>();
    for (const p of PROJECTS) {
      if (q && !`${p.name} ${p.blurb} ${p.group}`.toLowerCase().includes(q.toLowerCase())) continue;
      const list = map.get(p.group) || [];
      list.push(p);
      map.set(p.group, list);
    }
    return [...map.entries()];
  }, [q]);

  function saveSettings() {
    localStorage.setItem(KEY_URL, apiUrl.trim());
    localStorage.setItem(KEY_KEY, apiKey.trim());
    setTab("chat");
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: apiUrl,
          apiKey,
          model: "hermes-agent",
          messages: [
            { role: "system", content: `你是柯能的 Hermes Agent。當前專案上下文：${active}` },
            ...next.map(({ role, content }) => ({ role, content }))
          ]
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("沒有串流");
      const dec = new TextDecoder();
      let acc = "";
      setMessages([...next, { role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            acc += json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || "";
          } catch {
            acc += data;
          }
        }
        setMessages([...next, { role: "assistant", content: acc || "…" }]);
      }
    } catch (e) {
      setMessages([
        ...next,
        { role: "assistant", content: `連不上 Hermes：${e instanceof Error ? e.message : String(e)}` }
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">Hermes Console</div>
        <div className="sub">柯能·駐駛艙</div>
        <nav className="nav">
          {(["chat", "projects", "tools", "settings"] as Tab[]).map((id) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {id === "chat" ? "聊天" : id === "projects" ? "專案" : id === "tools" ? "工具" : "設定"}
            </button>
          ))}
        </nav>
        <div className="h">專案</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋" type="text" />
        {groups.map(([group, items]) => (
          <div key={group}>
            <div className="h">{group}</div>
            {items.map((p) => (
              <button
                key={p.name}
                className={`chip ${active === p.name ? "active" : ""}`}
                onClick={() => {
                  setActive(p.name);
                  setTab("chat");
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <section className="main">
        <div className="mobile-nav">
          {(["chat", "projects", "tools", "settings"] as Tab[]).map((id) => (
            <button key={id} className={tab === id ? "active chip" : "chip"} onClick={() => setTab(id)}>
              {id}
            </button>
          ))}
        </div>
        <header className="top">
          <div>
            <span className={`dot ${ready ? "ok" : ""}`} />
            {tab === "chat" ? `對話 · ${active}` : tab === "projects" ? "專案目錄" : tab === "tools" ? "工具" : "設定"}
          </div>
          <div className="muted">{ready ? "API 已設" : "尚未設 API"}</div>
        </header>

        {tab === "chat" && (
          <div className="chat">
            <div className="log">
              {messages.map((m, i) => (
                <article key={i} className={`msg ${m.role}`}>
                  {m.content}
                </article>
              ))}
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={ready ? "對 Hermes 說…" : "先到設定填網域"}
              />
              <button className="primary" type="submit" disabled={busy}>
                {busy ? "…" : "送出"}
              </button>
            </form>
          </div>
        )}

        {tab === "projects" && (
          <div className="panel">
            <div className="grid">
              {PROJECTS.map((p) => (
                <article key={p.name} className="card">
                  <h3>{p.name}</h3>
                  <p>{p.group} · {p.blurb}</p>
                  <div className="row">
                    <a href={p.url} target="_blank" rel="noreferrer">GitHub</a>
                    {p.live ? <a href={p.live} target="_blank" rel="noreferrer">網站</a> : null}
                    <button className="chip" onClick={() => { setActive(p.name); setTab("chat"); }}>
                      帶進聊天
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {tab === "tools" && (
          <div className="panel">
            <div className="grid">
              {TOOLS.map((t) => (
                <a key={t.name} className="card" href={t.href} target="_blank" rel="noreferrer">
                  <h3>{t.name}</h3>
                  <p>{t.status}</p>
                </a>
              ))}
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div className="panel" style={{ maxWidth: 560 }}>
            <div className="field">
              <label>Hermes API 網域</label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="https://xxxx.zeabur.app"
              />
            </div>
            <div className="field">
              <label>API Server Key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>
            <button className="primary" onClick={saveSettings}>
              儲存在本機
            </button>
            <p className="muted" style={{ marginTop: 12 }}>
              只填根網域，不要加 /v1/chat/completions。Key 只留在這台瀏覽器。
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
