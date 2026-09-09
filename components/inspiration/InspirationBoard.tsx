"use client";
import { useState } from "react";
import type { InspirationItem } from "@/lib/server/inspiration";
import type { SheetSyncResult } from "@/lib/server/inspiration/sheets-sync";
import {
  tkuVisualLanguage,
  type VisualPattern,
} from "@/lib/server/inspiration/visual-language";
import { Ban, ExternalLink, Image, Link2, Sparkles } from "lucide-react";

const KIND_LABEL: Record<VisualPattern["kind"], string> = {
  design: "畫面",
  layout: "版面",
  hook: "鉤子",
  cta: "行動",
  audience: "受眾",
};

export default function InspirationBoard({
  items,
  notice,
  syncStatus,
  onSync,
}: {
  items: InspirationItem[];
  notice: string;
  syncStatus: SheetSyncResult | null;
  onSync: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const language = tkuVisualLanguage();
  async function sync() {
    setBusy(true);
    setError("");
    try {
      await onSync();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "匯入失敗，請重試。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="inspiration-board">
      <div className="inspiration-heading">
        <div>
          <p className="eyebrow">參考板</p>
          <h1>靈感</h1>
        </div>
        <Sparkles size={25} aria-hidden="true" />
      </div>

      <article className="language-problem">
        <p className="eyebrow">目前最大問題</p>
        <h2>{language.biggestProblem}</h2>
        <p className="muted">
          已讀 {language.imageReadCount} 張 tku_zc 封面。未連接 Instagram。限動、Reels 動態與完整格狀仍是 UNKNOWN。
        </p>
        <ol>
          {language.improvements.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </article>

      <h2 className="language-section">值得學</h2>
      <ul className="pattern-grid">
        {language.keep.map((pattern) => (
          <PatternCard key={pattern.id} pattern={pattern} />
        ))}
      </ul>

      <h2 className="language-section">不適合禪學社</h2>
      <ul className="pattern-grid">
        {language.avoid.map((pattern) => (
          <PatternCard key={pattern.id} pattern={pattern} avoid />
        ))}
      </ul>

      <div className="handoff-grid">
        <article className="handoff-card">
          <p className="eyebrow">給 Visual Agent</p>
          <p>{language.visualAgent.brief}</p>
          <p>
            <strong>做</strong> {language.visualAgent.do.join("、")}
          </p>
          <p>
            <strong>不做</strong> {language.visualAgent.dont.join("、")}
          </p>
        </article>
        <article className="handoff-card">
          <p className="eyebrow">給 Copywriting Agent</p>
          <p>{language.copywritingAgent.brief}</p>
          <p>
            <strong>做</strong> {language.copywritingAgent.do.join("、")}
          </p>
          <p>
            <strong>不做</strong> {language.copywritingAgent.dont.join("、")}
          </p>
        </article>
      </div>

      <button type="button" disabled={busy} onClick={sync} style={{ minHeight: 44 }}>
        {busy ? "讀取中…" : "匯入已設定來源"}
      </button>
      <p className="muted">只讀取已設定來源；不會自動排程或更改權限。</p>
      {error && <p role="alert">{error}</p>}
      {syncStatus && (
        <div role="status">
          <p>
            最近匯入：{new Date(syncStatus.finishedAt).toLocaleString("zh-TW")}；
            讀取 {syncStatus.read}、新增 {syncStatus.created}、略過重複 {syncStatus.skipped}、
            失敗 {syncStatus.failed}。
          </p>
          {syncStatus.errors.length > 0 && (
            <details>
              <summary>查看失敗原因</summary>
              <ul>
                {syncStatus.errors.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
              <p>確認來源可讀後可重試；已收藏項目不會重複建立或覆蓋。</p>
            </details>
          )}
        </div>
      )}
      {notice && <p className="muted">{notice}</p>}
      {!items.length && (
        <p className="quiet">貼上 IG／Pinterest／網址，或直接在對話說「幫我找靈感」。</p>
      )}
      <ul>
        {items.map((item) => (
          <li key={item.id} className="inspiration-card">
            <a href={item.sourceUrl} target="_blank" rel="noreferrer">
              <span className="inspiration-thumb" aria-hidden="true">
                {item.platform.toLowerCase().includes("pinterest") ? (
                  <Image size={21} />
                ) : (
                  <Link2 size={21} />
                )}
              </span>
              <span>
                <strong>{item.platform}</strong>
                <small>{item.sourceUrl}</small>
              </span>
              <ExternalLink size={15} />
            </a>
            <details>
              <summary>分析與權利</summary>
              <p>{item.analysis}</p>
              <p>可借鑑：{item.borrow.join("、") || "尚未分析"}</p>
              <p>適合原因：{item.fit}</p>
              <p>風險：{item.risk}</p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PatternCard({
  pattern,
  avoid = false,
}: {
  pattern: VisualPattern;
  avoid?: boolean;
}) {
  return (
    <li className={"pattern-card" + (avoid ? " pattern-avoid" : "")}>
      <p className="pattern-meta">
        {avoid ? <Ban size={14} aria-hidden="true" /> : null}
        <span>{KIND_LABEL[pattern.kind]}</span>
        <span>{pattern.evidence[0]?.provenance}</span>
      </p>
      <strong>{pattern.title}</strong>
      <p>{pattern.summary}</p>
      <p className="muted">{pattern.why}</p>
      <details>
        <summary>證據與交接</summary>
        <ul>
          {pattern.evidence.map((item) => (
            <li key={item.source + item.note}>
              <span className="provenance-pill">{item.provenance}</span> {item.note}
            </li>
          ))}
        </ul>
        <p>Visual：{pattern.visualAgentInput}</p>
        <p>文案：{pattern.copywritingAgentInput}</p>
      </details>
    </li>
  );
}
