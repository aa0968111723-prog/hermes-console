import { scaffoldVariants } from "./drafts";
import { evaluateFreshmen } from "./freshmen";
import { lintCopy } from "./lint";
import {
  detectStructure,
  formatFromCopyFormat,
  normalizeFacts,
} from "./structure";
import {
  COPY_CHANNELS,
  COPY_REVIEW_DISCLAIMER,
  type CopyChannel,
  type CopyFacts,
  type CopyReview,
  type CopyVariantId,
} from "./types";

function asChannel(value?: string): CopyChannel {
  return COPY_CHANNELS.includes(value as CopyChannel)
    ? (value as CopyChannel)
    : "ig_caption";
}

export function reviewCopy(input: {
  channel?: CopyChannel | string;
  title?: string;
  copy?: string;
  variants?: Partial<Record<CopyVariantId, string>>;
  facts?: {
    name?: string | null;
    date?: string | null;
    time?: string | null;
    location?: string | null;
    formUrl?: string | null;
  };
  allowSpiritual?: boolean;
}): CopyReview {
  const channel = asChannel(input.channel);
  const variants = {
    a: Boolean(input.variants?.a?.trim() || input.copy?.trim()),
    b: Boolean(input.variants?.b?.trim()),
    c: Boolean(input.variants?.c?.trim()),
    missing: [] as string[],
  };
  if (!input.variants?.a?.trim() && !input.copy?.trim())
    variants.missing.push("A｜最自然");
  if (!input.variants?.b?.trim()) variants.missing.push("B｜最有梗");
  if (!input.variants?.c?.trim()) variants.missing.push("C｜最溫暖");

  const primary =
    input.variants?.a?.trim() ||
    input.copy?.trim() ||
    [input.title, input.variants?.b, input.variants?.c]
      .filter(Boolean)
      .join("\n");
  const text = [input.title, primary].filter(Boolean).join("\n");
  const facts = normalizeFacts(input.facts);
  const structure = detectStructure(text);
  if (facts.date.kind === "FACT" || facts.time.kind === "FACT")
    structure.timePlace = true;
  if (facts.location.kind === "FACT") structure.timePlace = true;
  structure.missing = structure.missing.filter((label) => {
    if (label === "時間／地點" && structure.timePlace) return false;
    return true;
  });

  const lint = lintCopy({
    text,
    channel,
    allowSpiritual: input.allowSpiritual,
  });
  const personas = evaluateFreshmen({
    text,
    lint,
    hasTimePlace: structure.timePlace,
    hasCta: structure.cta,
    locationUnknown: facts.location.kind === "UNKNOWN",
  });

  const next: string[] = [];
  if (variants.missing.length)
    next.push("補齊 A 最自然／B 最有梗／C 最溫暖 三版，不要只給一則。");
  if (structure.missing.length)
    next.push("依 HOOK → 生活場景 → 活動 → 為什麼來 → 時間地點 → CTA 補缺段。");
  if (lint.some((item) => item.severity === "block"))
    next.push("先拿掉宗教宣傳或未確認地點，再給新生看。");
  if (facts.location.kind === "UNKNOWN")
    next.push("地點仍是 UNKNOWN，對外文案標未定，不要捏造教室。");
  if (personas.filter((item) => !item.wouldStop).length >= 5)
    next.push("超過一半新生視角不會停下來，主標改成生活場景。");
  if (!next.length) next.push("三版可給幹部選；選定後才保存，不要發佈。");

  const kind = /社博|攤位|文館/.test(text + (facts.location.value || ""))
    ? "fair"
    : /茶會/.test(text + (facts.name.value || ""))
      ? "tea"
      : /演講|講座/.test(text + (facts.name.value || ""))
        ? "talk"
        : "generic";
  const suggestions = variants.missing.length
    ? scaffoldVariants({
        channel,
        facts: {
          name: facts.name.value,
          date: facts.date.value,
          time: facts.time.value,
          location: facts.location.value,
          formUrl: facts.formUrl.value,
        },
        kind,
      })
    : null;
  if (suggestions)
    next.push("下面是規則草稿，不是 Hermes 生成；選定後才保存。");

  return {
    simulation: true,
    method: "rule_contract",
    publish: false,
    channel,
    variants,
    structure,
    lint,
    facts,
    personas,
    next,
    suggestions,
    disclaimer: COPY_REVIEW_DISCLAIMER,
    note: "這是審核契約，不是 Hermes 生成的文案，也不是已發佈。",
  };
}

function rawFacts(
  facts?: CopyFacts | Parameters<typeof normalizeFacts>[0],
) {
  if (!facts) return undefined;
  if (
    facts.name &&
    typeof facts.name === "object" &&
    "kind" in facts.name
  ) {
    const typed = facts as CopyFacts;
    return {
      name: typed.name.value,
      date: typed.date.value,
      time: typed.time.value,
      location: typed.location.value,
      formUrl: typed.formUrl.value,
    };
  }
  return facts as Parameters<typeof normalizeFacts>[0];
}

export function reviewSavedCopy(input: {
  format?: string;
  title?: string;
  pages?: Array<{ title: string; body: string }>;
  facts?: CopyFacts | Parameters<typeof normalizeFacts>[0];
  allowSpiritual?: boolean;
}) {
  const copy = (input.pages || [])
    .map((page) => [page.title, page.body].filter(Boolean).join("\n"))
    .join("\n\n");
  return reviewCopy({
    channel: formatFromCopyFormat(input.format || "post"),
    title: input.title,
    copy,
    facts: rawFacts(input.facts),
    allowSpiritual: input.allowSpiritual,
  });
}

export { formatFromCopyFormat };

export function factsFromActivityRecord(info: {
  title: string;
  facts: Array<{
    field: string;
    visibility: string;
    state: string;
    value: string;
  }>;
}) {
  const value = (field: string) => {
    const confirmed = info.facts.filter(
      (item) =>
        item.field === field &&
        item.visibility === "public" &&
        item.state === "confirmed",
    );
    return confirmed.length === 1 ? confirmed[0].value : null;
  };
  return {
    name: value("name") || info.title,
    date: value("date"),
    time: value("time"),
    location: value("location"),
    formUrl: value("registration"),
  };
}
