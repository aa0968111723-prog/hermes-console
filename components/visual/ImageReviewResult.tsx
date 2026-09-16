"use client";
import type { ImageReviewPack } from "@/lib/image-review";

const STATUS = {
  unread: "未讀圖",
  simulated: "模擬",
} as const;

export default function ImageReviewResult({
  pack,
}: {
  pack: ImageReviewPack;
}) {
  return (
    <section className="image-review" aria-label="畫面審查">
      <p className="eyebrow">畫面審查 · 未讀像素</p>
      <ul className="image-review-checks">
        {pack.checklist.map((item) => (
          <li key={item.id} data-status={item.status}>
            <strong>{item.label}</strong>
            <span>{STATUS[item.status]}</span>
            <p>{item.note}</p>
          </li>
        ))}
      </ul>
      <ul className="image-review-suggestions">
        {pack.suggestions.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
