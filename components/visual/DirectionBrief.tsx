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
                <span>{COPY_LABEL[id]}</span>
                <strong>{format.label}</strong>
                <p
                  className="direction-format-copy preserve-lines"
                  data-emphasis={
                    brief.visualNote?.includes("主標加大") ? "larger" : undefined
                  }
                >
                  {text}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <details className="direction-review-fold">
        <summary>新生視角審核（模擬）</summary>
        <CopyReviewCard review={brief.review} />
      </details>
      {brief.visualNote ? <p className="quiet">{brief.visualNote}</p> : null}
      <p className="quiet">{brief.notice}</p>
    </section>
  );
}
