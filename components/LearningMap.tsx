"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { learningCategories, learningStates, type LearningView } from "@/lib/learning";
import type { DiscoveryItem, Material } from "@/lib/contracts";

async function api(method: string, projectId: string, body?: unknown) {
  const response = await fetch("/api/learning?projectId=" + encodeURIComponent(projectId), {
    method, headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(40_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "無法讀取學習資料。");
  return result;
}
export default function LearningMap({ projectId, skills, materials, onTask }: {
  projectId: string; skills: DiscoveryItem[]; materials: Material[]; onTask: (id: string) => void;
}) {
  const [nodes, setNodes] = useState<LearningView[]>([]);
  const [editing, setEditing] = useState<LearningView | null>(null);
  const [title, setTitle] = useState(""), [content, setContent] = useState("");
  const [category, setCategory] = useState<LearningView["category"]>("preference");
  const [parentId, setParentId] = useState(""), [sources, setSources] = useState("");
  const [materialIds, setMaterialIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [scopeVerified, setScopeVerified] = useState(false);
  const operation = useRef<{signature: string; id: string} | null>(null);
  const refresh = useCallback(async () => {
    const data = await api("GET", projectId);
    setNodes(data.nodes); setScopeVerified(data.scopeVerified);
  }, [projectId]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await api("GET", projectId);
        if (active) { setNodes(data.nodes); setScopeVerified(data.scopeVerified); }
      } catch (e) { if (active) setError((e as Error).message); }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [projectId]);
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await fn(); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function edit(node: LearningView | null) {
    setEditing(node); setTitle(node?.title || ""); setContent(node?.content || "");
    setCategory(node?.category || "preference"); setParentId(node?.parentId || "");
    setSources(node?.sources.join("\n") || ""); setConsent(false);
    setMaterialIds(node?.materialIds || []);
  }
  function branch(node: LearningView, depth = 0): React.ReactNode {
    if (depth > 100) return null;
    const children = nodes.filter(n => n.parentId === node.id);
    const attempt = node.attempts.at(-1);
    return <li key={node.id}>
      <details>
        <summary><strong>{node.title}</strong> <small>v{node.revision} · {learningStates[node.state]}</small></summary>
        <p className="preserve-lines">{node.content}</p>
        {node.sources.map(source => <p key={source}><a href={source} target="_blank" rel="noreferrer">學習來源：{source}</a></p>)}
        {(node.materialIds || []).map(id => <p key={id}>關聯素材：{materials.find(m => m.id === id)?.title || "素材目前不可用"}</p>)}
        <p className="muted">來源尚需由 Hermes 實際讀取；不是模型權重訓練。保存於 Console 不等於已寫入 Hermes。</p>
        {attempt?.error && <p role="status">{attempt.error}</p>}
        {attempt && <p>上次要求：{attempt.action === "learn" ? "學習" : "忘記"} v{attempt.revision}；遠端保存／刪除尚未驗證。</p>}
        <div className="workbench-actions">
          <button onClick={() => edit(node)}>修改學習內容</button>
          <button disabled={busy || !consent || !scopeVerified} onClick={() => void act(async () => {
            await api("PATCH", projectId, { id: node.id, expectedRevision: node.revision, action: "learn" });
          })}>請 Hermes 學習</button>
          <button disabled={busy || !consent || !scopeVerified || !attempt?.taskId} onClick={() => {
            if (window.confirm("請 Hermes 移除這個節點對應的記憶／技能？其他記憶不在範圍內；完成後仍須查證。"))
              void act(async () => { await api("PATCH", projectId, { id: node.id, expectedRevision: node.revision, action: "forget" }); });
          }}>請 Hermes 忘記此項</button>
          {attempt?.taskId && <button onClick={() => onTask(attempt.taskId!)}>查看執行與停止</button>}
        </div>
        <details><summary>修訂來源與歷史（{node.history.length}）</summary>
          {node.history.map(v => <article key={v.revision}><h4>v{v.revision} · {v.savedAt}</h4><p className="preserve-lines">{v.content}</p></article>)}
        </details>
      </details>
      {!!children.length && <ul>{children.map(child => branch(child, depth + 1))}</ul>}
    </li>;
  }
  return <section className="learning-map workbench" aria-label="記憶與學習地圖">
    <h3>你想讓龜龜學會什麼？</h3>
    <p>把偏好、品牌範例與工作方法組成學習樹。連線表示你設定的關聯，不代表熟練度或自動解鎖。</p>
    {!scopeVerified && <p className="error">尚未驗證部署端記憶範圍，先保存學習資料；不會自動送出。</p>}
    <p className="muted">目前為共用工作區。專案標籤不保證 Hermes 底層記憶隔離；不要加入私人校務、密碼或 token。</p>
    {error && <p role="alert">{error}</p>}
    <label className="check-row"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
      我確認要送出的內容可用於此工作區的 Hermes 記憶／技能
    </label>
    <form onSubmit={e => {
      e.preventDefault();
      void act(async () => {
        const input = { ...(editing ? { id: editing.id } : {}), projectId,
          expectedRevision: editing?.revision || 0, title, content, category, parentId: parentId || null,
          sources: sources.split("\n").map(s => s.trim()).filter(Boolean), materialIds };
        const signature = JSON.stringify(input);
        if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
        await api("POST", projectId, { ...input, operationId: operation.current.id });
        edit(null); operation.current = null;
      });
    }}>
      <h4>{editing ? "修訂學習資料" : "新增學習資料"}</h4>
      <label>學習標題<input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>學習分類<select aria-label="學習分類" value={category} onChange={e => setCategory(e.target.value as LearningView["category"])}>
        {Object.entries(learningCategories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label>上層關聯<select aria-label="上層關聯" value={parentId} onChange={e => setParentId(e.target.value)}>
        <option value="">獨立主題</option>
        {nodes.filter(n => n.id !== editing?.id).map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
      </select></label>
      <label>希望記住／學會的內容<textarea aria-label="希望記住／學會的內容" required rows={4} maxLength={1600} value={content} onChange={e => setContent(e.target.value)} placeholder="例如：社團貼文先講活動價值，語氣親切，不使用浮誇形容詞。" /></label>
      <label>來源網址（最多 4 筆，每行一筆）<textarea aria-label="來源網址（最多 4 筆，每行一筆）" rows={2} value={sources} onChange={e => setSources(e.target.value)} /></label>
      <fieldset><legend>已上傳的學習素材（最多 4 個）</legend>
        {materials.filter(m => m.projectId === projectId).map(m => <label className="check-row" key={m.id}>
          <input type="checkbox" checked={materialIds.includes(m.id)}
            disabled={!materialIds.includes(m.id) && materialIds.length >= 4}
            onChange={e => setMaterialIds(old => e.target.checked ? [...old,m.id] : old.filter(id => id !== m.id))} />
          {m.title}
        </label>)}
        <p>圖片需部署端支援影像輸入；PDF 尚未接入全文解析，不會冒充已讀。</p>
      </fieldset>
      <button disabled={busy} className="primary">保存學習資料</button>
      {editing && <button type="button" onClick={() => edit(null)}>取消修訂</button>}
    </form>
    <div className="learning-root">我的學習地圖 · {nodes.length} 個指定主題</div>
    {Object.entries(learningCategories).map(([id, label]) => {
      const roots = nodes.filter(n => n.category === id && !n.parentId);
      return roots.length > 0 && <section key={id}><h4>{label}</h4><ul className="learning-tree">{roots.map(n => branch(n))}</ul></section>;
    })}
    {!nodes.length && <p>還沒有指定學習主題。先加入真實範例與你希望沿用的規則。</p>}
    <details><summary>Hermes 實際列出的技能（{skills.length}）</summary>
      <p>僅代表實例列出，不代表上述學習任務已保存或技能已執行成功。</p>
      {skills.map(s => <p key={s.name}><strong>{s.name}</strong>：{s.description}</p>)}
    </details>
  </section>;
}
