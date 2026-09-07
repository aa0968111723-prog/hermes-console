"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Activity,
  type CopyDocument,
  type CopyCheck,
  type Fact,
  type CopyRevision,
} from "@/lib/creative";
import { fieldLabels } from "@/lib/activity-labels";
import type { Material } from "@/lib/contracts";
import type { Workflow } from "@/lib/server/workflows";
type Data = {
  activities: Activity[];
  copies: Array<CopyDocument & { check: CopyCheck }>;
};
async function request<T>(
  method: string,
  body?: unknown,
  projectId?: string,
): Promise<T> {
  const response = await fetch(
    "/api/creative" +
      (projectId ? "?projectId=" + encodeURIComponent(projectId) : ""),
    {
      method,
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "無法完成操作。");
  return data;
}
export default function ProjectWorkbench({
  projectId,
  materials,
  workflows,
  onCompose,
}: {
  projectId: string;
  materials: Material[];
  workflows: Workflow[];
  onCompose: (text: string) => void;
}) {
  const [data, setData] = useState<Data>({ activities: [], copies: [] });
  const [editing, setEditing] = useState<Activity | null>(null);
  const [title, setTitle] = useState("");
  const [facts, setFacts] = useState<
    Array<{
      field: Fact["field"];
      value: string;
      visibility: Fact["visibility"];
      sources: Fact["sources"];
    }>
  >([]);
  const [copy, setCopy] = useState<CopyDocument | null>(null);
  const [copyTitle, setCopyTitle] = useState("");
  const [format, setFormat] = useState<CopyRevision["format"]>("post");
  const [activityId, setActivityId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [pages, setPages] = useState<CopyRevision["pages"]>([
    { title: "", body: "", visual: "" },
  ]);
  const [tone, setTone] = useState(""),
    [audience, setAudience] = useState("");
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const alive = useRef(true);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const refresh = useCallback(async () => {
    const result = await request<Data>("GET", undefined, projectId);
    if (alive.current) setData(result);
  }, [projectId]);
  useEffect(() => {
    alive.current = true;
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      if (!document.hidden) void refresh().catch(() => {});
    }, 5000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function op(input: unknown) {
    const signature = JSON.stringify(input);
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: crypto.randomUUID() };
    return operation.current.id;
  }
  function editActivity(a: Activity | null) {
    setEditing(a);
    setTitle(a?.title || "");
    setFacts(
      a?.facts.map(({ field, value, visibility, sources }) => ({
        field,
        value,
        visibility,
        sources,
      })) ||
        Object.keys(fieldLabels).map((f) => ({
          field: f as Fact["field"],
          value: "",
          visibility: "public",
          sources: [],
        })),
    );
  }
  function editCopy(d: CopyDocument | null, revision = d?.revisions.at(-1)) {
    setCopy(d);
    setCopyTitle(revision?.title || "");
    setFormat(revision?.format || "post");
    setActivityId(d?.activityId || data.activities[0]?.id || "");
    setWorkflowId(revision?.workflowId || "");
    setPages(
      revision?.pages.map((p) => ({ ...p })) || [
        { title: "", body: "", visual: "" },
      ],
    );
    setSelectedMaterials(revision?.materialIds || []);
    setTone(revision?.tone || "");
    setAudience(revision?.audience || "");
  }
  return (
    <section className="workbench" aria-label="活動資料與文案工作區">
      <h2>活動資料與文案</h2>
      <p className="muted">
        保存於後端，可由 Hermes 查回接續；不是長期記憶，也不代表已製作或發佈。
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="workbench-actions">
        <button onClick={() => editActivity(null)}>建立活動資料</button>
        <button
          disabled={!data.activities.length}
          onClick={() => editCopy(null)}
        >
          新增文案草稿
        </button>
        <button
          onClick={() =>
            onCompose(
              "請先用 workspace_project_context 查回這個專案的活動、來源及已有文案；核對必要資訊後，接續網宣草稿。缺少日期或地點先詢問我，不要捏造。",
            )
          }
        >
          請 Hermes 接續創作
        </button>
      </div>
      {facts.length > 0 && (
        <details open>
          <summary>
            {editing ? "修改活動資料 · v" + editing.revision : "新增活動資料"}
          </summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const input = {
                  ...(editing ? { id: editing.id } : {}),
                  projectId,
                  expectedRevision: editing?.revision || 0,
                  title,
                  facts: facts.filter((f) => f.value.trim()),
                };
                const result = await request<{ activity: Activity }>("POST", {
                  kind: "activity",
                  input: { ...input, operationId: op(input) },
                });
                setEditing(result.activity);
                setFacts([]);
                operation.current = null;
                setNotice("活動已保存，新增或變更的資訊仍需核對。");
              });
            }}
          >
            <label>
              活動資料標題
              <input
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            {facts.map((f, i) => (
              <fieldset key={i}>
                <legend>{fieldLabels[f.field]}</legend>
                <label>
                  內容
                  <input
                    value={f.value}
                    maxLength={1000}
                    onChange={(e) =>
                      setFacts((old) =>
                        old.map((x, n) =>
                          n === i ? { ...x, value: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  資料範圍
                  <select
                    aria-label="資料範圍"
                    value={f.visibility}
                    onChange={(e) =>
                      setFacts((old) =>
                        old.map((x, n) =>
                          n === i
                            ? {
                                ...x,
                                visibility: e.target
                                  .value as Fact["visibility"],
                              }
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="public">公開網宣資料</option>
                    <option value="private">私人資料，不提供給網宣工具</option>
                  </select>
                </label>
                <label>
                  來源網址（選填）
                  <input
                    type="url"
                    placeholder="https://…"
                    value={f.sources[0]?.url || ""}
                    onChange={(e) =>
                      setFacts((old) =>
                        old.map((x, n) =>
                          n === i
                            ? {
                                ...x,
                                sources: e.target.value
                                  ? [
                                      {
                                        url: e.target.value,
                                        queriedAt: new Date().toISOString(),
                                        note: "使用者填入，非自動查詢證據",
                                      },
                                    ]
                                  : [],
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
              </fieldset>
            ))}
            <button className="primary" disabled={busy}>
              保存活動資料
            </button>
            <button type="button" onClick={() => setFacts([])}>
              取消編輯
            </button>
          </form>
        </details>
      )}
      {data.activities.map((a) => (
        <details key={a.id}>
          <summary>
            {a.title} · v{a.revision}
          </summary>
          <p className="muted">
            逐項確認公開資訊；同欄位有不同來源時，選定其中一筆會將其他候選保留為已排除。
          </p>
          {a.facts.map((f) => (
            <div key={f.id} className="fact-row">
              <strong>{fieldLabels[f.field]}</strong>
              <p>{f.value}</p>
              <small>
                {f.visibility === "private" ? "私人" : "公開"} ·{" "}
                {
                  {
                    pending: "待核對",
                    user_provided: "使用者提供",
                    confirmed: "已確認",
                    rejected: "已排除",
                  }[f.state]
                }
              </small>
              {f.sources.map((s) => (
                <p key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    來源
                  </a>{" "}
                  ·{" "}
                  <time dateTime={s.queriedAt}>
                    {new Date(s.queriedAt).toLocaleString("zh-TW")}
                  </time>{" "}
                  · {s.note}
                </p>
              ))}
              {f.visibility === "public" && f.state !== "confirmed" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await request("PATCH", {
                        action: "confirm_facts",
                        id: a.id,
                        expectedRevision: a.revision,
                        factIds: [f.id],
                      });
                      setNotice(
                        "已記錄你的確認；其他尚未確認欄位不會自動通過。",
                      );
                    })
                  }
                >
                  確認此資訊
                </button>
              )}
            </div>
          ))}
          <button onClick={() => editActivity(a)}>修改活動</button>
          <button
            onClick={() =>
              onCompose(
                `請讀取活動 ${a.id}（專案 ${projectId}），依已確認資訊提出三個方向，保存後等待我選擇；私人資訊不得用於公開文宣。`,
              )
            }
          >
            請 Hermes 整理三個方向
          </button>
          <details>
            <summary>活動修改歷史（{a.history.length} 版）</summary>
            {a.history.map((r) => (
                <p key={r.revision}>
                  v{r.revision} · {r.at} · {r.actor} · {r.facts.length} 項資訊
                </p>
            ))}
          </details>
        </details>
      ))}
      {activityId && (
        <details open>
          <summary>{copy ? "編輯同一文案，另存新版本" : "新增文案"}</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const info = data.activities.find((a) => a.id === activityId)!;
                const input = {
                  ...(copy ? { id: copy.id } : {}),
                  projectId,
                  activityId,
                  ...(workflowId ? { workflowId } : {}),
                  expectedRevision: copy?.revisions.at(-1)?.revision || 0,
                  title: copyTitle,
                  format,
                  tone,
                  audience,
                  pages,
                  materialIds: selectedMaterials,
                  factIds: info.facts
                    .filter(
                      (f) =>
                        f.visibility === "public" && f.state === "confirmed",
                    )
                    .map((f) => f.id),
                };
                const result = await request<{ copy: CopyDocument }>("POST", {
                  kind: "copy",
                  input: { ...input, operationId: op(input) },
                });
                setCopy(result.copy);
                setActivityId("");
                operation.current = null;
                setNotice("文案新版本已保存；原版本仍可查閱、下載。");
              });
            }}
          >
            <label>
              文案所屬活動
              <select
                aria-label="文案所屬活動"
                value={activityId}
                disabled={!!copy}
                onChange={(e) => { setActivityId(e.target.value); setWorkflowId(""); }}
              >
                {data.activities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              已選定的創作方向（選填）
              <select aria-label="已選定的創作方向（選填）" value={workflowId} onChange={e => setWorkflowId(e.target.value)}>
                <option value="">尚未關聯方向</option>
                {workflows.filter(w => w.activityId === activityId && w.selected !== null).map(w =>
                  <option key={w.id} value={w.id}>{w.directions[w.selected!].title}</option>
                )}
              </select>
            </label>
            <label>
              文案標題
              <input
                required
                maxLength={150}
                value={copyTitle}
                onChange={(e) => setCopyTitle(e.target.value)}
              />
            </label>
            <label>
              文案語氣
              <input
                maxLength={300}
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              />
            </label>
            <label>
              文案受眾
              <input
                maxLength={500}
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              />
            </label>
            <label>
              文案格式
              <select
                aria-label="文案格式"
                value={format}
                onChange={(e) =>
                  setFormat(e.target.value as CopyRevision["format"])
                }
              >
                <option value="post">Instagram 貼文</option>
                <option value="carousel">輪播逐頁</option>
                <option value="story">限時動態</option>
                <option value="reel">短影音腳本</option>
              </select>
            </label>
            {pages.map((p, i) => (
              <fieldset key={i}>
                <legend>第 {i + 1} 頁／段</legend>
                <label>
                  頁面標題
                  <input
                    value={p.title}
                    onChange={(e) =>
                      setPages((old) =>
                        old.map((x, n) =>
                          n === i ? { ...x, title: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  頁面文案
                  <textarea
                    aria-label="頁面文案"
                    rows={5}
                    required
                    maxLength={10_000}
                    value={p.body}
                    onChange={(e) =>
                      setPages((old) =>
                        old.map((x, n) =>
                          n === i ? { ...x, body: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  視覺／鏡頭需求
                  <textarea
                    aria-label="視覺／鏡頭需求"
                    rows={2}
                    maxLength={2000}
                    value={p.visual}
                    onChange={(e) =>
                      setPages((old) =>
                        old.map((x, n) =>
                          n === i ? { ...x, visual: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                {pages.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setPages((old) => old.filter((_, n) => n !== i))
                    }
                  >
                    移除此頁
                  </button>
                )}
              </fieldset>
            ))}
            <button
              type="button"
              disabled={pages.length >= 20}
              onClick={() =>
                setPages((old) => [...old, { title: "", body: "", visual: "" }])
              }
            >
              新增一頁／段
            </button>
            <fieldset>
              <legend>關聯素材</legend>
              {materials
                .filter((m) => m.projectId === projectId)
                .map((m) => (
                  <label className="check-row" key={m.id}>
                    <input
                      type="checkbox"
                      checked={selectedMaterials.includes(m.id)}
                      onChange={(e) =>
                        setSelectedMaterials((old) =>
                          e.target.checked
                            ? [...old, m.id]
                            : old.filter((id) => id !== m.id),
                        )
                      }
                    />
                    {m.title}
                  </label>
                ))}
            </fieldset>
            <button className="primary" disabled={busy}>
              保存文案版本
            </button>
            <button type="button" onClick={() => setActivityId("")}>
              取消編輯文案
            </button>
          </form>
        </details>
      )}
      {data.copies.map((d) => (
        <details key={d.id}>
          <summary>
            {d.revisions.at(-1)!.title} · {d.revisions.length} 版
            {d.selectedRevision
              ? " · 已選 v" + d.selectedRevision
              : " · 未選定"}
          </summary>
          <p>
            以下核對最新版本的已知資訊與引用，不代表已選版本或所有內容均正確。各版本下載時會重新核對。
          </p>
          {d.check.issues.map((issue, i) => (
            <p className="error" key={i}>
              {issue}
            </p>
          ))}
          {d.revisions.map((r) => (
            <details key={r.revision}>
              <summary>
                v{r.revision} · {r.at} · {r.actor}
              </summary>
              {r.pages.map((p, i) => (
                <section key={i}>
                  <h3>
                    第 {i + 1} 頁：{p.title}
                  </h3>
                  <p className="preserve-lines">{p.body}</p>
                  <small>視覺需求：{p.visual}</small>
                </section>
              ))}
              <div className="workbench-actions">
                <button onClick={() => editCopy(d, r)}>
                  以 v{r.revision} 繼續修改
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await request("PATCH", {
                        action: "select_copy",
                        id: d.id,
                        expectedRevision: d.revisions.at(-1)!.revision,
                        revision: r.revision,
                      });
                      setNotice("已選定文案版本；沒有發佈或排程。");
                    })
                  }
                >
                  選定 v{r.revision}
                </button>
                <a
                  className="button-link"
                  href={`/api/creative?download=${d.id}&revision=${r.revision}`}
                >
                  下載 v{r.revision} 文案
                </a>
                <button
                  onClick={() =>
                    onCompose(
                      `請用 workspace_get_copy 讀取文案 ${d.id}，以 v${r.revision} 為修改基礎。先問我要改哪一頁或語氣，再沿用相同 id 保存新版本；不要重新搜尋或重建無關作品。`,
                    )
                  }
                >
                  在對話接續修改
                </button>
                {d.selectedRevision === r.revision && r.workflowId && <button
                  onClick={() => onCompose(
                    `請用 workspace_get_copy 查回文案 ${d.id} 已選版本 v${r.revision}，並查回方向流程 ${r.workflowId}。確認日期地點與素材後，依真實 Canva 範本欄位製作；若未授權請保留進度，不要宣稱完成。已有設計時先查回，不要重複建立。`
                  )}>交給 Hermes 接續製作</button>}
              </div>
            </details>
          ))}
        </details>
      ))}
    </section>
  );
}
