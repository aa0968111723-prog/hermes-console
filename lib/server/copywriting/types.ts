export const COPY_CHANNELS = [
  "ig_caption",
  "carousel",
  "poster_title",
  "poster_subtitle",
  "cta",
  "reels_hook",
  "story",
  "recruitment",
  "dm_invite",
  "event_intro",
  "post_event",
  "google_form",
] as const;

export type CopyChannel = (typeof COPY_CHANNELS)[number];

export const COPY_VARIANTS = ["a", "b", "c"] as const;
export type CopyVariantId = (typeof COPY_VARIANTS)[number];

export const COPY_STRUCTURE = [
  "hook",
  "relatable",
  "activity",
  "whyJoin",
  "timePlace",
  "cta",
] as const;
export type CopyStructureSlot = (typeof COPY_STRUCTURE)[number];

export const COPY_VARIANT_LABELS: Record<CopyVariantId, string> = {
  a: "最自然",
  b: "最有梗",
  c: "最溫暖",
};

export const CHANNEL_LIMITS: Record<
  CopyChannel,
  { max: number; firstLineMax?: number; needCta?: boolean; needTimePlace?: boolean }
> = {
  ig_caption: { max: 2200, firstLineMax: 40, needCta: true, needTimePlace: true },
  carousel: { max: 400, firstLineMax: 16, needCta: true },
  poster_title: { max: 16 },
  poster_subtitle: { max: 28 },
  cta: { max: 12, needCta: true },
  reels_hook: { max: 18 },
  story: { max: 80, needCta: true },
  recruitment: { max: 800, needCta: true, needTimePlace: true },
  dm_invite: { max: 120, needCta: true },
  event_intro: { max: 600, needCta: true, needTimePlace: true },
  post_event: { max: 800 },
  google_form: { max: 400, needCta: true, needTimePlace: true },
};

export type ProvenanceKind = "FACT" | "UNKNOWN";

export interface CopyFactField {
  value: string | null;
  kind: ProvenanceKind;
}

export interface CopyFacts {
  name: CopyFactField;
  date: CopyFactField;
  time: CopyFactField;
  location: CopyFactField;
  formUrl: CopyFactField;
}

export interface CopyLintIssue {
  kind: "banned" | "jargon" | "religious" | "preachy" | "placeholder" | "length" | "pressure";
  term: string;
  message: string;
  severity: "block" | "warn";
}

export interface CopyPersonaReview {
  id: string;
  label: string;
  firstReaction: string;
  wouldStop: boolean;
  pressure: boolean;
  understands: boolean;
  wouldFillForm: boolean;
  wouldWalkIn: boolean;
  questions: string[];
}

export interface CopyReview {
  simulation: true;
  method: "rule_contract";
  publish: false;
  channel: CopyChannel;
  variants: {
    a: boolean;
    b: boolean;
    c: boolean;
    missing: string[];
  };
  structure: Record<CopyStructureSlot, boolean> & { missing: string[] };
  lint: CopyLintIssue[];
  facts: CopyFacts;
  personas: CopyPersonaReview[];
  next: string[];
  disclaimer: string;
  note: string;
}

export const COPY_REVIEW_DISCLAIMER =
  "規則式文案審核，未呼叫 AI 模型，不是真實停留率或報名轉換。";
