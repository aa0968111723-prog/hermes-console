"use client";
import type { DirectionBriefPack } from "@/lib/direction-brief";
import CopyReviewCard from "@/components/copywriting/CopyReviewCard";

const COPY_LABEL = {
  a: "最自然",
  b: "最有梗",
  c: "最溫暖",
} as const;

export default function DirectionBrief({
  brief,
}: {
  brief: DirectionBriefPack;
}) {
  const pages = [
    ["a", brief.copy.a],
    ["b", brief.copy.b],
    ["c", brief.copy.c],
  ] as const;
  return (
    <section className="direction-brief" aria-label="已選方向規格">
      <p className="eyebrow">
        方向 {brief.selected}
        {brief.revision ? " · V" + brief.revision : ""}
        {" · 規格草稿 · 未出圖"}
      </p>
      <h2>{brief.title}</h2>
      <p>{brief.summary}</p>
      <ul className="direction-format-grid">
        {brief.formats.map((format, index) => {
          const [id, text] = pages[index] || pages[0];
          return (
            <li key={format.id}>
              <div
                className="direction-format-frame"
                data-aspect={format.aspect}
              >
                <span>
                  {format.aspect} · {COPY_LABEL[id]}
                </span>
                <strong>{format.label}</strong>
                <p className="direction-format-copy preserve-lines">{text}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <details className="direction-review-fold">
        <summary>新生視角審核（模擬）</summary>
        <CopyReviewCard review={brief.review} />
      </details>
      <p className="quiet">{brief.notice}</p>
    </section>
  );
}
