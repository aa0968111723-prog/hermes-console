"use client";
import { useState } from "react";
import type { InspirationItem } from "@/lib/server/inspiration";
import type { SheetSyncResult } from "@/lib/server/inspiration/sheets-sync";
import {
  tkuVisualLanguage,
  type VisualPattern,
} from "@/lib/server/inspiration/visual-language";
import { Ban, ExternalLink, Image, Link2, Sparkles } from "lucide-react";
import RecruitmentTruthNotice from "@/components/help/RecruitmentTruthNotice";
import { RecruitmentFunnelFold } from "@/components/help/RecruitmentFunnelCard";
import type { InspirationSearchPack } from "@/lib/inspiration-pack";
import InspirationResult from "@/components/visual/InspirationResult";
import DirectionBrief from "@/components/visual/DirectionBrief";
import type { DirectionBriefPack } from "@/lib/direction-brief";

const KIND_LABEL: Record<VisualPattern["kind"], string> = {
  design: "畫面",
  layout: "版面",
  hook: "鉤子",
  cta: "行動",
  audience: "受眾",
};

const PROVENANCE_LABEL: Record<string, string> = {
  FACT: "事實",
  EVIDENCE: "已有來源",
  INFERENCE: "推論",
  INSPIRATION: "靈感",
  UNKNOWN: "尚未確認",
};

export default function InspirationBoard({
  items,
  notice,
  syncStatus,
  pack,
  onSync,
  onSelectDirection,
  selectedDirection,
  selecting = false,
  brief = null,
}: {
  items: InspirationItem[];
  notice: string;
  syncStatus: SheetSyncResult | null;
  pack?: InspirationSearchPack | null;
  onSync: () => Promise<void>;
  onSelectDirection?: (id: "A" | "B" | "C", pack: InspirationSearchPack) => void;
  selectedDirection?: "A" | "B" | "C" | null;
  selecting?: boolean;
  brief?: DirectionBriefPack | null;
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
        <h1>靈感</h1>
        <Sparkles size={25} aria-hidden="true" />
      </div>

      {pack && (
        <InspirationResult
          pack={pack}
          onSelect={
            onSelectDirection ? (id) => onSelectDirection(id, pack) : undefined
          }
          selectedId={selectedDirection}
          busy={selecting}
        />
      )}
      {brief && <DirectionBrief brief={brief} />}

      <RecruitmentTruthNotice />
      <RecruitmentFunnelFold />

      <details className="language-fold">
        <summary>社團視覺語言</summary>
      <article className="language-problem">
        <p className="eyebrow">目前最大問題</p>
        <h2>{language.biggestProblem}</h2>
        <p className="muted">
          已讀 {language.imageReadCount} 張 tku_zc 封面。未連接 Instagram。限動、Reels 動態與完整格狀仍尚未確認。
        </p>
        <ol>
          {language.improvements.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </article>

      <article className="handoff-card live-watch">
        <p className="eyebrow">現場觀察 · {language.live.today}</p>
        <p>
          Feed EVIDENCE：{language.live.feed.hook}
          {language.live.feed.stale ? "（已過期）" : ""}
        </p>
        <p>
          限動 {PROVENANCE_LABEL[language.live.story.provenance] || "尚未確認"}：{language.live.story.note}
        </p>
        <p>{language.live.planVsLive}</p>
      </article>

      <article className="handoff-card next-slot">
        <p className="eyebrow">下一步 · {language.nextSlot.format}</p>
        <strong>
          {language.nextSlot.title} {language.nextSlot.date}
        </strong>
        <p>
          {language.nextSlot.location.value}
          <span className="provenance-pill">
            {PROVENANCE_LABEL[language.nextSlot.location.provenance] ||
              "尚未確認"}
          </span>
        </p>
        <p>Visual：{language.nextSlot.visualAgentInput}</p>
        <p>文案：{language.nextSlot.copywritingAgentInput}</p>
        {language.nextSlot.beats && (
          <ol className="story-beats">
            {language.nextSlot.beats.map((beat) => (
              <li key={beat.frame}>
                {beat.frame}. {beat.onImage}
                <small> ≤{beat.maxChars}字</small>
              </li>
            ))}
          </ol>
        )}
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
      </details>

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
        <p className="quiet">在對話說「幫我找靈感」，或貼上已授權來源。</p>
      )}
      {items.length > 0 && (
        <details className="inspiration-links">
          <summary>已收藏連結 {items.length}</summary>
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
        </details>
      )}
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
        <span>
          {PROVENANCE_LABEL[pattern.evidence[0]?.provenance || ""] || "尚未確認"}
        </span>
      </p>
      <strong>{pattern.title}</strong>
      <p>{pattern.summary}</p>
      <details>
        <summary>為什麼</summary>
        <p className="muted">{pattern.why}</p>
        <ul>
          {pattern.evidence.map((item) => (
            <li key={item.source + item.note}>
              <span className="provenance-pill">
                {PROVENANCE_LABEL[item.provenance] || "尚未確認"}
              </span>{" "}
              {item.note}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}
