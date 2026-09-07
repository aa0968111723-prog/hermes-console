"use client";

import { useCallback, useEffect, useState } from "react";

type Memory = {
  id: string;
  scope: string;
  kind: "fact" | "note" | "preference" | "scope";
  title: string;
  content: string;
  tags: string[];
  revision: number;
  updatedAt: string;
};

type Share = {
  store: string;
  sharedVia: string[];
  hermesRemote: string;
  scopeVerified: boolean;
  count: number;
  synced: boolean;
  notice: string;
};

const KINDS: Record<Memory["kind"], string> = {
  fact: "事實",
  note: "筆記",
  preference: "偏好",
  scope: "範圍備註",
};

const REMOTE: Record<string, string> = {
  available: "Hermes 已宣告記憶能力（範圍已聲明）",
  unverified: "Hermes 已宣告記憶，範圍尚未驗證",
  unsupported: "此 Hermes 未宣告遠端記憶",
  unknown: "尚未確認 Hermes 遠端記憶",
};

export default function SharedMemory({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Memory[]>([]);
  const [share, setShare] = useState<Share | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [kind, setKind] = useState<Memory["kind"]>("note");
  const [scope, setScope] = useState("workspace");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/memory?scope=all", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || "無法讀取共用記憶。");
    setItems(body.memories || []);
    setShare(body.share || null);
  }, []);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  function resetForm(item: Memory | null = null) {
    setEditing(item);
    setKind(item?.kind || "note");
    setScope(item?.scope || "workspace");
    setTitle(item?.title || "");
    setContent(item?.content || "");
    setTags(item?.tags.join(", ") || "");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/memory", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing?.id,
          expectedRevision: editing?.revision,
          kind,
          scope,
          title,
          content,
          tags: tags
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || "無法保存記憶。");
      resetForm(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-stack shared-memory">
      <h3>共用記憶庫</h3>
      <p className="muted">{share?.notice}</p>
      <dl className="facts">
        <dt>存放位置</dt>
        <dd>CONSOLE_DATA_DIR SQLite</dd>
        <dt>與 Hermes 共用</dt>
        <dd>Workspace MCP + 任務指示</dd>
        <dt>遠端記憶同步</dt>
        <dd>
          {share ? REMOTE[share.hermesRemote] || share.hermesRemote : "讀取中"}
          {share?.synced ? "" : " · 未宣稱已鏡像"}
        </dd>
        <dt>筆數</dt>
        <dd>{share?.count ?? "—"}</dd>
      </dl>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        <label>
          類型
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Memory["kind"])}
          >
            {Object.entries(KINDS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          範圍
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="workspace">整個工作區</option>
            <option value={projectId}>目前專案</option>
          </select>
        </label>
        <label>
          標題
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={120}
            autoComplete="off"
          />
        </label>
        <label>
          內容
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            maxLength={2000}
            rows={4}
            autoComplete="off"
          />
        </label>
        <label>
          標籤（逗號分隔）
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="credential-actions">
          <button type="submit" disabled={busy}>
            {editing ? "更新記憶" : "新增記憶"}
          </button>
          {editing && (
            <button type="button" onClick={() => resetForm(null)}>
              取消編輯
            </button>
          )}
        </div>
      </form>
      <ul className="memory-list">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted">
              {KINDS[item.kind]} · {item.scope} · v{item.revision}
            </span>
            <p className="preserve-lines">{item.content}</p>
            <div className="credential-actions">
              <button type="button" onClick={() => resetForm(item)}>
                編輯
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm("刪除這筆共用記憶？Hermes 之後也讀不到。"))
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    const response = await fetch("/api/memory", {
                      method: "DELETE",
                      credentials: "same-origin",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: item.id }),
                    });
                    const body = await response.json().catch(() => ({}));
                    if (!response.ok)
                      throw new Error(body.error?.message || "無法刪除。");
                    if (editing?.id === item.id) resetForm(null);
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                刪除
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!items.length && <p className="muted">尚未保存共用記憶。</p>}
    </div>
  );
}
