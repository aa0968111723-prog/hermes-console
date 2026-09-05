export function socialDrafts(input: {
  title: string;
  copy: string;
  cta: string;
  audience: string;
}) {
  const hashtags = ["淡江", "大一", "社團", "淡水"].map((tag) => "#" + tag);
  return {
    publish: false,
    ig: {
      shortCaption: `${input.title}。${input.cta}`.slice(0, 120),
      longCaption: `${input.copy}\n\n${input.cta}\n給${input.audience}。`.slice(0, 500),
      hashtags,
      altText: `${input.title} 活動海報，含時間地點。`,
      cta: input.cta,
    },
    story: `${input.title}\n今天在校園，歡迎過來坐。`.slice(0, 80),
    threads: `${input.copy}`.slice(0, 220),
    poster: input.copy,
    note: "同一活動在 Feed／Story／Threads／海報的文案刻意不同。此為草稿，不是發佈。",
  };
}
