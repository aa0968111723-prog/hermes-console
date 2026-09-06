"use client";

import { useState } from "react";
import { Search, X, Check, Copy, Palette, Bookmark, ExternalLink } from "lucide-react";
import type { InspirationItem, InspirationPlatform } from "@/lib/server/inspiration";
import type { CuratedInspirationItem } from "@/lib/server/inspiration/engine";

interface Props {
  items: InspirationItem[];
  fixtures?: CuratedInspirationItem[];
  notice?: string;
  projectId?: string;
  onIngest?: (item: InspirationItem) => void;
}

export default function InspirationBoard({
  items,
  fixtures = [],
  notice,
  projectId = "personal",
  onIngest,
}: Props) {
  const [activeTab, setActiveTab] = useState<"saved" | "curated">("saved");
  const [selectedPlatform, setSelectedPlatform] = useState<"all" | InspirationPlatform>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  // 表單狀態
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [account, setAccount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; isError: boolean } | null>(null);

  const showFeedback = (text: string, isError: boolean = false) => {
    setFeedback({ text, isError });
    setTimeout(() => setFeedback(null), 3500);
  };

  const copyHex = (hex: string) => {
    navigator.clipboard.writeText(hex).catch(() => {});
    setCopiedHex(hex);
    setTimeout(() => setCopiedHex(null), 1800);
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
        credentials: "same-origin",
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
      setActiveTab("saved");
      onIngest?.(data.item);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showFeedback(`收藏失敗: ${msg}`, true);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 平台統計數字
  const platformCounts: Record<string, number> = {
    all: items.length,
    instagram: items.filter((i) => i.platform === "instagram").length,
    pinterest: items.filter((i) => i.platform === "pinterest").length,
    canva: items.filter((i) => i.platform === "canva").length,
    behance: items.filter((i) => i.platform === "behance").length,
    web: items.filter((i) => ["web", "dribbble", "project"].includes(i.platform)).length,
  };

  // 過濾使用者收藏項目
  const filteredItems = items.filter((item) => {
    if (selectedPlatform !== "all") {
      if (selectedPlatform === "web") {
        if (!["web", "dribbble", "project"].includes(item.platform)) return false;
      } else if (item.platform !== selectedPlatform) {
        return false;
      }
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.sourceUrl.toLowerCase().includes(q) ||
      (item.account && item.account.toLowerCase().includes(q)) ||
      (item.captionExcerpt && item.captionExcerpt.toLowerCase().includes(q)) ||
      item.hashtags.some((tag) => tag.toLowerCase().includes(q)) ||
      item.analysis.toLowerCase().includes(q) ||
      item.borrow.some((b) => b.toLowerCase().includes(q)) ||
      item.fit.toLowerCase().includes(q)
    );
  });

  return (
    <section className="inspiration-board-container">
      {/* 頂部標題 */}
      <div className="board-header">
        <div className="board-title-row">
          <span className="board-badge">💡 HERMES INSPIRATION VAULT</span>
          <h1>萬象靈感庫</h1>
        </div>
        <p className="board-notice">
          {notice ||
            "統一靈感引擎：未授權時不搜尋完整 Instagram／Pinterest。支援收藏公開 HTTPS 網址與即時版面分析。"}
        </p>
      </div>

      {/* 快速網址收藏卡片 */}
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

      {/* 雙頁籤切換：已收藏靈感 vs 內建風格色票庫 */}
      <div className="inspiration-tabs-bar">
        <button
          type="button"
          className={`inspiration-tab-btn ${activeTab === "saved" ? "active" : ""}`}
          onClick={() => setActiveTab("saved")}
        >
          <Bookmark size={15} />
          <span>已收藏靈感 ({items.length})</span>
        </button>
        <button
          type="button"
          className={`inspiration-tab-btn ${activeTab === "curated" ? "active" : ""}`}
          onClick={() => setActiveTab("curated")}
        >
          <Palette size={15} />
          <span>內建萬象風格庫 ({fixtures.length})</span>
        </button>
      </div>

      {/* Tab 1: 已收藏靈感列表與多維篩選 */}
      {activeTab === "saved" && (
        <div className="tab-content-saved">
          <div className="board-filter-toolbar">
            {/* 平台切換膠囊 */}
            <div className="platform-filter-chips">
              {[
                { key: "all", label: "全部" },
                { key: "instagram", label: "Instagram" },
                { key: "pinterest", label: "Pinterest" },
                { key: "canva", label: "Canva" },
                { key: "behance", label: "Behance" },
                { key: "web", label: "一般網頁" },
              ].map((p) => {
                const count = platformCounts[p.key] || 0;
                const active = selectedPlatform === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`platform-filter-chip ${active ? "active" : ""}`}
                    onClick={() => setSelectedPlatform(p.key as any)}
                  >
                    <span>{p.label}</span>
                    <span className="chip-count">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* 即時搜尋關鍵字 */}
            <div className="board-search-box">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                className="board-search-input"
                placeholder="過濾網址、帳號、摘要、借鑑點..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery("")}
                  title="清除搜尋"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {!filteredItems.length ? (
            <div className="inspiration-empty-box">
              <span className="empty-icon">📭</span>
              <h3>
                {items.length === 0
                  ? "靈感庫目前還是一張白紙"
                  : "沒有符合目前篩選條件的靈感"}
              </h3>
              <p>
                {items.length === 0
                  ? "請在上方貼入 Instagram、Pinterest 或其他公開 HTTPS 來源網址，或於對話中呼叫靈感工具。"
                  : "試著切換平台篩選或清除關鍵字搜尋條件。"}
              </p>
            </div>
          ) : (
            <div className="inspiration-cards-grid">
              {filteredItems.map((item) => (
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
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={item.sourceUrl}
                    >
                      <span>{item.sourceUrl}</span>
                      <ExternalLink size={12} className="link-ext-icon" />
                    </a>
                  </div>

                  {item.captionExcerpt && (
                    <p className="insp-caption-excerpt">
                      <strong>摘要：</strong>
                      {item.captionExcerpt}
                    </p>
                  )}

                  {item.hashtags && item.hashtags.length > 0 && (
                    <div className="insp-tags-row">
                      {item.hashtags.map((tag) => (
                        <span key={tag} className="insp-mini-tag">
                          #{tag}
                        </span>
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
                            <span key={b} className="borrow-pill">
                              {b}
                            </span>
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
        </div>
      )}

      {/* Tab 2: 內建萬象風格庫與調色盤展示 */}
      {activeTab === "curated" && (
        <div className="tab-content-curated">
          {!fixtures.length ? (
            <div className="inspiration-empty-box">
              <span className="empty-icon">🎨</span>
              <h3>尚無當前專案適配之萬象風格</h3>
              <p>內建風格參考庫將依據專案脈絡（淡江、臺大或通用大專）提供色調與版面建議。</p>
            </div>
          ) : (
            <div className="curated-cards-grid">
              {fixtures.map((fixture) => (
                <article key={fixture.id} className="curated-card">
                  <div className="curated-topbar">
                    <span className={`curated-domain-badge domain-${fixture.domain}`}>
                      {fixture.domain === "tamkang"
                        ? "🏫 淡江脈絡"
                        : fixture.domain === "ntu"
                        ? "🚲 臺大脈絡"
                        : "🎓 通用大專"}
                    </span>
                    <span className="curated-type-tag">{fixture.type}</span>
                    <span className="curated-mood-tag">✨ {fixture.visualMood}</span>
                  </div>

                  <h3 className="curated-title">{fixture.title}</h3>
                  <p className="curated-description">{fixture.description}</p>

                  {/* 核心調色盤展示與點擊複製色碼 */}
                  <div className="palette-section">
                    <div className="palette-header">
                      <span className="palette-label">推薦色盤（點擊複製 HEX）：</span>
                      {copiedHex && (
                        <span className="copy-toast">
                          <Check size={12} /> 已複製 {copiedHex}
                        </span>
                      )}
                    </div>
                    <div className="palette-swatches-grid">
                      {fixture.colorPalette.map((col) => {
                        const isCopied = copiedHex === col.hex;
                        return (
                          <button
                            key={col.hex}
                            type="button"
                            className={`palette-swatch ${isCopied ? "copied" : ""}`}
                            onClick={() => copyHex(col.hex)}
                            title={`點擊複製 ${col.hex}`}
                          >
                            <span
                              className="swatch-color-box"
                              style={{ backgroundColor: col.hex }}
                            />
                            <span className="swatch-info">
                              <span className="swatch-name">{col.name}</span>
                              <span className="swatch-hex">{col.hex}</span>
                            </span>
                            <span className="swatch-copy-icon">
                              {isCopied ? <Check size={11} /> : <Copy size={11} />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 排版與字體建議 */}
                  {fixture.typographySuggestion && (
                    <div className="typography-box">
                      <span className="typography-label">排版建議：</span>
                      <p className="typography-text">{fixture.typographySuggestion}</p>
                    </div>
                  )}

                  {/* 標籤 */}
                  {fixture.tags && fixture.tags.length > 0 && (
                    <div className="insp-tags-row">
                      {fixture.tags.map((tag) => (
                        <span key={tag} className="insp-mini-tag">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 誠實出處聲明 */}
                  <div className="curated-rights-note">
                    <span>🛡️ {fixture.rightsNote}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}


