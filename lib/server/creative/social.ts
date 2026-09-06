export function socialDrafts(input: {
  title: string;
  copy: string;
  cta: string;
  audience: string;
}) {
  // Formatting user-provided copy is not AI generation or image analysis.
  return {
    publish: false,
    method: "text_formatting",
    requiresReview: true,
    ig: {
      shortCaption: [input.title, input.cta]
        .filter(Boolean)
        .join("。")
        .slice(0, 120),
      longCaption: [input.copy, input.cta]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 500),
      hashtags: [],
      altText: null,
      cta: input.cta,
    },
    story: [input.title, input.cta].filter(Boolean).join("\n").slice(0, 80),
    threads: input.copy.slice(0, 220),
    poster: input.copy,
    note: "僅整理提供的文字，不會補造活動時間、地點或圖片替代文字；字数裁切仍需人工確認。",
  };
}
