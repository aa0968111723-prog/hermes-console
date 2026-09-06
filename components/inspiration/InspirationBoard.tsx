"use client";
import { useState } from "react";
import type { InspirationItem } from "@/lib/server/inspiration";
import type { SheetSyncResult } from "@/lib/server/inspiration/sheets-sync";

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
  async function sync() {
    setBusy(true); setError("");
    try { await onSync(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "匯入失敗，請重試。"); }
    finally { setBusy(false); }
  }
  return (
    <section className="inspiration-board">
      <h1>靈感</h1>
      <button type="button" disabled={busy} onClick={sync} style={{ minHeight: 44 }}>
        {busy ? "正在讀取試算表…" : "匯入已設定的 4 份試算表"}
      </button>
      <p className="muted">點擊後讀取已設定來源，將新文字列收藏至各自專案；不會自動定期執行或更改試算表權限。</p>
      {error && <p role="alert">{error}</p>}
      {syncStatus && <div role="status">
        <p>最近匯入：{new Date(syncStatus.finishedAt).toLocaleString("zh-TW")}；
          讀取 {syncStatus.read}、新增 {syncStatus.created}、略過重複 {syncStatus.skipped}、
          失敗 {syncStatus.failed}。</p>
        {syncStatus.errors.length > 0 && <details><summary>查看失敗原因</summary>
          <ul>{syncStatus.errors.map((message, index) => <li key={index}>{message}</li>)}</ul>
          <p>確認來源可讀後可重試；已收藏項目不會重複建立或覆蓋。</p>
        </details>}
      </div>}
      <p className="muted">
        {notice ||
          "統一靈感引擎：未授權時不搜尋完整 Instagram／Pinterest。"}
      </p>
      {!items.length && <p className="quiet">貼上 IG／Pinterest／網址，或直接在對話說「幫我找靈感」。</p>}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <a href={item.sourceUrl} target="_blank" rel="noreferrer">
              {item.platform} · {item.sourceUrl}
            </a>
            <p>{item.analysis}</p>
            <p>可借鑑：{item.borrow.join("、") || "尚未分析"}</p>
            <p>適合原因：{item.fit}</p>
            <p>風險：{item.risk}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
