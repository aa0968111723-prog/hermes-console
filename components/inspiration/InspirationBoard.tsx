"use client";

import { useState } from "react";
import type { InspirationItem } from "@/lib/server/inspiration";

interface Props {
  items: InspirationItem[];
  notice?: string;
  projectId?: string;
  onIngest?: (item: InspirationItem) => void;
}

export default function InspirationBoard({
  items,
  notice,
  projectId = "personal",
  onIngest,
}: Props) {
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [account, setAccount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; isError: boolean } | null>(null);

  const showFeedback = (text: string, isError: boolean = false) => {
    setFeedback({ text, isError });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = url.trim();
    if (!cleanUrl) return;

    if (!cleanUrl.startsWith("https://")) {
      showFeedback("只接受不含帳密的公開 HTTPS 網址。", true);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/inspiration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ingest",
          url: cleanUrl,
          caption: caption.trim() || undefined,
          account: account.trim() || undefined,
          projectId,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.item) {
        throw new Error(data.error?.message || data.error || `HTTP ${res.status}`);
      }

      showFeedback("✨ 已成功收藏進靈感庫，並完成結構化版面分析！");
      setUrl("");
      setCaption("");
      setAccount("");
      onIngest?.(data.item);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showFeedback(`收藏失敗: ${msg}`, true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="inspiration-board-container">
      <div className="board-header">
        <div className="board-title-row">
          <span className="board-badge">💡 HERMES INSPIRATION VAULT</span>
          <h1>萬象靈感庫</h1>
        </div>
        <p className="board-notice">
          {notice || "統一靈感引擎：未授權時不搜尋完整 Instagram／Pinterest。支援收藏公開 HTTPS 網址與即時版面分析。"}
        </p>
      </div>

      {/* 互動式快速網址收藏卡片 */}
      <div className="inspiration-ingest-card">
        <div className="ingest-card-header">
          <span className="ingest-icon">📌</span>
          <strong>收藏新靈感 (HTTPS 來源網址)</strong>
          <span className="ingest-project-tag">專案：{projectId}</span>
        </div>
        <form onSubmit={handleIngest} className="ingest-form">
          <div className="ingest-form-row">
            <input
              type="url"
              className="ingest-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="貼上公開 HTTPS 網址（例如 Instagram 貼文、Pinterest Pin、Canva 範本、Behance 作品）"
              required
              disabled={isSubmitting}
            />
            <button
              type="submit"
              className="ingest-submit-btn"
              disabled={isSubmitting || !url.trim()}
            >
              {isSubmitting ? "分析收藏中..." : "＋ 收藏靈感"}
            </button>
          </div>
          <div className="ingest-optional-row">
            <input
              type="text"
              className="ingest-subinput"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="作者／帳號（選填，知道才填）"
              disabled={isSubmitting}
            />
            <input
              type="text"
              className="ingest-subinput flex-1"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="備註說明或文案摘要（選填，最多 500 字）"
              disabled={isSubmitting}
            />
          </div>
        </form>

        {feedback && (
          <div className={`ingest-feedback ${feedback.isError ? "error" : "success"}`}>
            {feedback.text}
          </div>
        )}
      </div>

      {/* 靈感列表統計與卡片展示 */}
      <div className="board-items-header">
        <span className="items-count-label">已收藏靈感 ({items.length})</span>
      </div>

      {!items.length ? (
        <div className="inspiration-empty-box">
          <span className="empty-icon">📭</span>
          <h3>靈感庫目前還是一張白紙</h3>
          <p>請在上方貼入 Instagram、Pinterest 或其他公開 HTTPS 來源網址，或於對話中呼叫靈感工具。</p>
        </div>
      ) : (
        <div className="inspiration-cards-grid">
          {items.map((item) => (
            <article key={item.id} className="inspiration-card">
              <div className="insp-card-topbar">
                <span className={`platform-tag platform-${item.platform}`}>
                  {item.platform}
                </span>
                {item.account && <span className="account-tag">@{item.account}</span>}
                <span className="collected-date">
                  {new Date(item.collectedAt).toLocaleDateString()}
                </span>
              </div>

              <div className="insp-source-link">
                <a href={item.sourceUrl} target="_blank" rel="noreferrer" title={item.sourceUrl}>
                  {item.sourceUrl} ↗
                </a>
              </div>

              {item.captionExcerpt && (
                <p className="insp-caption-excerpt">
                  <strong>摘要：</strong>{item.captionExcerpt}
                </p>
              )}

              {item.hashtags && item.hashtags.length > 0 && (
                <div className="insp-tags-row">
                  {item.hashtags.map((tag) => (
                    <span key={tag} className="insp-mini-tag">#{tag}</span>
                  ))}
                </div>
              )}

              <div className="insp-analysis-box">
                <div className="analysis-row">
                  <span className="analysis-label">版面分析：</span>
                  <span className="analysis-text">{item.analysis}</span>
                </div>
                {item.borrow && item.borrow.length > 0 && (
                  <div className="analysis-row">
                    <span className="analysis-label">可借鑑處：</span>
                    <div className="borrow-tags">
                      {item.borrow.map((b) => (
                        <span key={b} className="borrow-pill">{b}</span>
                      ))}
                    </div>
                  </div>
                )}
                {item.fit && (
                  <div className="analysis-row">
                    <span className="analysis-label">適合原因：</span>
                    <span className="analysis-text">{item.fit}</span>
                  </div>
                )}
                {item.risk && (
                  <div className="analysis-row risk">
                    <span className="analysis-label">著作權提醒：</span>
                    <span className="analysis-text">{item.risk}</span>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

