"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PROJECTS, TOOLS } from "@/lib/catalog";

type Tab = "chat" | "projects" | "tools" | "settings";
type Msg = { role: "user" | "assistant"; content: string };
type Conv = { id: string; title: string; messages: Msg[] };

const URL_KEY = "hermes.apiUrl";
const KEY_KEY = "hermes.apiKey";
const CONV_KEY = "hermes.convs";

const STARTERS = [
  { t: "檢查 Hermes", d: "API 是否可用，不要回印密鑰" },
  { t: "今天做什麼", d: "從控制台開始最小下一步" },
  { t: "列出我的專案", d: "用目錄解釋 ai_os、canva2、學校社團" },
  { t: "怎麼填設定", d: "只說根網域，不要 /v1/chat/completions" }
];

export default function Page() {
  const [tab, setTab] = useState<Tab>("chat");
  const [open, setOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [convs, setConvs] = useState<Conv[]>([{ id: "c1", title: "新對話", messages: [] }]);
  const [cid, setCid] = useState("c1");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setApiUrl(localStorage.getItem(URL_KEY) || "");
    setApiKey(localStorage.getItem(KEY_KEY) || "");
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

  useEffect(() => {
    localStorage.setItem(CONV_KEY, JSON.stringify(convs));
  }, [convs]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [convs, cid, tab]);

  const ready = Boolean(apiUrl.trim() && apiKey.trim());
  const conv = useMemo(() => convs.find((c) => c.id === cid) || convs[0], [convs, cid]);
  const messages = conv?.messages || [];

  function patch(next: Msg[]) {
    setConvs((all) => all.map((c) => (c.id === cid ? { ...c, messages: next, title: c.title === "新對話" && next[0] ? next[0].content.slice(0, 24) : c.title } : c)));
  }

  function newChat() {
    const id = `c${Date.now()}`;
    setConvs((all) => [{ id, title: "新對話", messages: [] }, ...all]);
    setCid(id);
    setTab("chat");
    setOpen(false);
  }

  function saveSettings() {
    localStorage.setItem(URL_KEY, apiUrl.trim());
    localStorage.setItem(KEY_KEY, apiKey.trim());
    setTab("chat");
  }

  async function send(textRaw?: string) {
    const text = (textRaw ?? input).trim();
    if (!text || busy) return;
    if (!ready) {
      setTab("settings");
      return;
    }
    const next = [...messages, { role: "user" as const, content: text }];
    patch(next);
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
          messages: [{ role: "system", content: "你是柏能的 Hermes。用繁體中文、簡短回答。不要回印密鑰。" }, ...next]
        })
      });
      if (!res.ok || !res.body) {
        const err = await res.text();
        patch([...next, { role: "assistant", content: err || "連不上 Hermes" }]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      let buf = "";
      patch([...next, { role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop() || "";
        for (const line of parts) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const data = s.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            acc += json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || "";
          } catch {
            acc += data;
          }
          patch([...next, { role: "assistant", content: acc || "…" }]);
        }
      }
    } catch (e) {
      patch([...next, { role: "assistant", content: `連不上 Hermes：${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <aside className={open ? "side open" : "side"}>
        <div className="brand">Hermes</div>
        <div className="sub">柏能的簡易聊天</div>
        <button className="newchat" onClick={newChat}>＋ 新對話</button>
        <nav className="nav">
          <button className={tab === "chat" ? "active" : ""} onClick={() => { setTab("chat"); setOpen(false); }}>聊天</button>
          <button className={tab === "projects" ? "active" : ""} onClick={() => { setTab("projects"); setOpen(false); }}>專案</button>
          <button className={tab === "tools" ? "active" : ""} onClick={() => { setTab("tools"); setOpen(false); }}>工具</button>
          <button className={tab === "settings" ? "active" : ""} onClick={() => { setTab("settings"); setOpen(false); }}>設定</button>
        </nav>
        <div className="convs">
          {convs.map((c) => (
            <button key={c.id} className={c.id === cid ? "active" : ""} onClick={() => { setCid(c.id); setTab("chat"); setOpen(false); }}>{c.title}</button>
          ))}
        </div>
        <div className="side-foot">
          <div className="sub"><span className={ready ? "dot ok" : "dot"} />{ready ? "已設定 API" : "先到設定填網域"}</div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="menu" onClick={() => setOpen((v) => !v)}>選單</button>
          <div>Hermes {tab === "chat" ? "· 聊天" : tab === "projects" ? "· 專案" : tab === "tools" ? "· 工具" : "· 設定"}</div>
          <div>{ready ? "已連" : "未設定"}</div>
        </div>

        {tab === "chat" && (
          <>
            <div className="thread" ref={logRef}>
              {messages.length === 0 ? (
                <div className="empty">
                  <h1>今天要做什麼？</h1>
                  <p>{ready ? "直接問，或點一個建議" : "先到左側設定填 Hermes API 根網域與 Key"}</p>
                  <div className="suggestions">
                    {STARTERS.map((s) => (
                      <button key={s.t} onClick={() => send(s.t)}>
                        {s.t}
                        <small>{s.d}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="thread-inner">
                  {messages.map((m, i) => (
                    <div key={i} className={m.role === "user" ? "row-msg user" : "row-msg"}>
                      {m.role === "assistant" ? <div className="avatar bot">H</div> : null}
                      <div className={m.role === "user" ? "bubble user" : "bubble"}>{m.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="composer-wrap">
              <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <textarea
                  rows={1}
                  value={input}
                  placeholder={ready ? "訊息 Hermes" : "先到設定填網域"}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <button className="send" type="submit" disabled={busy || !input.trim()}>{busy ? "…" : "↑"}</button>
              </form>
              <div className="hint">簡易 ChatGPT 樣式。Key 只留在這台瀏覽器。</div>
            </div>
          </>
        )}

        {tab === "projects" && (
          <div className="sheet">
            {PROJECTS.map((p) => (
              <article key={p.name} className="card">
                <h3>{p.name}</h3>
                <p>{p.group} · {p.blurb}</p>
                <div style={{ marginTop: 8 }}><a href={p.url} target="_blank" rel="noreferrer">GitHub</a></div>
              </article>
            ))}
          </div>
        )}

        {tab === "tools" && (
          <div className="sheet">
            {TOOLS.map((t) => (
              <a key={t.name} className="card" href={t.href === "#dashboard" ? "https://455.zeabur.app" : t.href} target="_blank" rel="noreferrer">
                <h3>{t.name}</h3>
                <p>{t.status}</p>
              </a>
            ))}
          </div>
        )}

        {tab === "settings" && (
          <div className="sheet">
            <div className="field">
              <label>根網域（不要加 /v1/chat/completions）</label>
              <input value={apiUrl} placeholder="https://xxxx.zeabur.app" onChange={(e) => setApiUrl(e.target.value)} />
            </div>
            <div className="field">
              <label>API Server Key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>
            <button className="primary" onClick={saveSettings}>儲存</button>
            <p className="hint">Dashboard：https://455.zeabur.app · API port 5000 要另纁網域</p>
          </div>
        )}
      </main>
    </div>
  );
}
