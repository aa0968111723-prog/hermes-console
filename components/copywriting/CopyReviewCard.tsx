"use client";
import type { CopyReview } from "@/lib/server/copywriting";

const CHANNEL: Record<string, string> = {
  ig_caption: "貼文",
  carousel: "輪播",
  poster_title: "海報主標",
  poster_subtitle: "海報副標",
  cta: "行動呼籲",
  reels_hook: "短影音開頭",
  story: "限時動態",
  recruitment: "招生",
  dm_invite: "私訊邀請",
  event_intro: "活動說明",
  post_event: "活動後",
  google_form: "表單",
};

export default function CopyReviewCard({
  review,
}: {
  review: CopyReview;
}) {
  const missing = [
    ...review.variants.missing.map((item) => "缺 " + item),
    ...review.structure.missing.map((item) => "缺 " + item),
  ];
  const blockers = review.lint.filter((item) => item.severity === "block");
  const stopped = review.personas.filter((item) => item.wouldStop).length;
  return (
    <section className="copy-review" aria-label="新生視角文案審核">
      <header className="copy-review-head">
        <p>
          {CHANNEL[review.channel] || "文案"} · 規則審核 · 不會發佈
        </p>
        <p>
          {stopped}/{review.personas.length} 個新生視角會停下來
        </p>
      </header>
      {missing.length > 0 && (
        <ul className="copy-review-chips">
          {missing.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {blockers.map((item) => (
        <p className="error" key={item.kind + item.term}>
          {item.term}：{item.message}
        </p>
      ))}
      <details>
        <summary>十個新生怎麼看</summary>
        <ul className="copy-review-twins">
          {review.personas.map((persona) => (
            <li key={persona.id}>
              <strong>{persona.label}</strong>
              <p>{persona.firstReaction}</p>
              {persona.questions[0] && <small>{persona.questions[0]}</small>}
            </li>
          ))}
        </ul>
      </details>
      <ol className="copy-review-next">
        {review.next.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
      {review.suggestions && (
        <details>
          <summary>規則草稿 A／B／C（未保存、未發佈）</summary>
          <p>
            <strong>A 最自然</strong>
          </p>
          <p className="preserve-lines">{review.suggestions.variants.a}</p>
          <p>
            <strong>B 最有梗</strong>
          </p>
          <p className="preserve-lines">{review.suggestions.variants.b}</p>
          <p>
            <strong>C 最溫暖</strong>
          </p>
          <p className="preserve-lines">{review.suggestions.variants.c}</p>
          <small>{review.suggestions.note}</small>
        </details>
      )}
      <small>{review.disclaimer}</small>
    </section>
  );
}
