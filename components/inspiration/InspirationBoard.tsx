"use client";
import type { InspirationItem } from "@/lib/server/inspiration";

export default function InspirationBoard({
  items,
  notice,
}: {
  items: InspirationItem[];
  notice: string;
}) {
  return (
    <section className="inspiration-board">
      <h1>靈感</h1>
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
