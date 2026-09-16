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
        {brief.formats.map((format) => (
          <li key={format.id}>
            <div
              className="direction-format-frame"
              style={{ aspectRatio: format.aspect.replace(":", " / ") }}
            >
              <span>{format.aspect}</span>
              <strong>{format.label}</strong>
            </div>
            <small>{format.compositionHint}</small>
          </li>
        ))}
      </ul>
      <ul className="direction-copy-grid">
        {(
          [
            ["a", brief.copy.a],
            ["b", brief.copy.b],
            ["c", brief.copy.c],
          ] as const
        ).map(([id, text]) => (
          <li key={id}>
            <span>{id.toUpperCase()}</span>
            <strong>{COPY_LABEL[id]}</strong>
            <p className="preserve-lines">{text}</p>
          </li>
        ))}
      </ul>
      <details className="direction-review-fold">
        <summary>新生視角審核（模擬）</summary>
        <CopyReviewCard review={brief.review} />
      </details>
      <p className="quiet">{brief.notice}</p>
    </section>
  );
}
