import { DEFAULT_BUDGET } from "./budgets";

export const AUDIENCE_DISCLAIMER =
  "AI 模擬評估，不代表真實市場調查。";

export const SCORE_KEYS = [
  "stopRate",
  "comprehension",
  "relevance",
  "localness",
  "peerFeel",
  "freshness",
  "credibility",
  "shareIntent",
  "clickIntent",
  "joinIntent",
  "adFeel",
  "distance",
  "religiousDistance",
  "infoLoad",
  "ctaClarity",
] as const;

export type ScoreKey = (typeof SCORE_KEYS)[number];

export const PERSPECTIVES = [
  "目標受眾",
  "無感路人",
  "懷疑者",
  "同儕",
  "創意總監",
] as const;

export const DEBATE_ROLES = [
  "新生",
  "社團幹部",
  "懷疑者",
  "研究代理",
  "創意總監",
] as const;

export type EvidenceKind = "evidence" | "hypothesis";

export interface TwinFact {
  field: string;
  value: string;
  kind: EvidenceKind;
  source: string | null;
}

export interface AudienceTwin {
  label: string;
  facts: TwinFact[];
  graph: Array<{ from: string; to: string; source: string | null }>;
  disclaimer: string;
}

export interface AudienceScores {
  scores: Record<ScoreKey, number>;
  disclaimer: string;
}

export function classifyFact(value: string, source: string | null): TwinFact["kind"] {
  return source ? "evidence" : "hypothesis";
}

export function buildTwin(input: {
  label: string;
  items: Array<{ field: string; value: string; source?: string | null }>;
  graph?: Array<{ from: string; to: string; source?: string | null }>;
}): AudienceTwin {
  return {
    label: input.label,
    facts: input.items.map((item) => ({
      field: item.field,
      value: item.value,
      kind: classifyFact(item.value, item.source || null),
      source: item.source || null,
    })),
    graph: (input.graph || []).map((edge) => ({
      from: edge.from,
      to: edge.to,
      source: edge.source || null,
    })),
    disclaimer: AUDIENCE_DISCLAIMER,
  };
}

export function reverseThinkingTriggers(text: string): string[] {
  const hits: string[] = [];
  if (/反向想|反向思考|倒過來想/.test(text)) hits.push("reverse_prompt");
  if (/站在.+角度|從受眾|目標客群角度/.test(text)) hits.push("audience_angle");
  if (/如果我是/.test(text)) hits.push("if_i_were");
  if (/路人會不會滑掉|會不會滑掉|會被滑掉/.test(text)) hits.push("swipe_risk");
  return hits;
}

export function wantsReverseThinking(text: string) {
  return reverseThinkingTriggers(text).length > 0;
}

export function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeScores(
  raw: Partial<Record<ScoreKey, number>>,
): AudienceScores {
  const scores = {} as Record<ScoreKey, number>;
  for (const key of SCORE_KEYS) scores[key] = clampScore(raw[key] ?? 0);
  return { scores, disclaimer: AUDIENCE_DISCLAIMER };
}

export function debateSummary(input: {
  support: string[];
  oppose: string[];
  concerns: string[];
  revisions: string[];
}) {
  return {
    consensus: input.support.slice(0, 8),
    dissent: input.oppose.concat(input.concerns).slice(0, 8),
    revisions: input.revisions.slice(0, 8),
  };
}

export function tamkangFreshmanSeed(sources: Array<{ text: string; url?: string }>) {
  const known = sources.filter((item) => item.text.trim());
  const items: Array<{ field: string; value: string; source?: string | null }> = [
    { field: "年齡", value: "約 18–19 歲", source: null },
    { field: "Life stage", value: "剛進入大學的生活轉換期", source: null },
    { field: "校園階段", value: "淡江大學大一新生", source: null },
    { field: "生活環境", value: "淡水校園與周邊生活圈", source: known[0]?.url || null },
    { field: "日常情境", value: "通學、社團、找吃的、認識朋友", source: null },
    { field: "關注事項", value: "社團、交通、住宿、餐飲、新生活動", source: null },
    { field: "期待", value: "交到朋友、找到屬於自己的圈子", source: null },
    { field: "疑問", value: "這裡好走嗎？有人跟我一樣嗎？", source: null },
    { field: "壓力", value: "新環境、課業、人際與距離", source: null },
    { field: "社交需求", value: "低門檻、可一起參加的實體活動", source: null },
    { field: "可能使用的平台", value: "Instagram、Dcard、社團群組", source: null },
    { field: "可能滑掉的內容", value: "抽象口號、過度宗教或廣告感", source: null },
    { field: "可能停下來看的內容", value: "有淡江生活感、看得懂、跟我有關", source: null },
    { field: "參與觸發因素", value: "同學邀約、現場好找、時間清楚", source: null },
  ];
  if (!known.length) {
    for (const item of items) item.source = null;
  }
  return buildTwin({
    label: "淡江大學大一新生",
    items,
    graph: [
      { from: "大一新生", to: "搬到淡水", source: known[0]?.url || null },
      { from: "搬到淡水", to: "新環境" },
      { from: "新環境", to: "克難坡" },
      { from: "克難坡", to: "找朋友" },
      { from: "找朋友", to: "社團" },
      { from: "社團", to: "找吃的" },
      { from: "找吃的", to: "住宿" },
      { from: "住宿", to: "自由" },
      { from: "自由", to: "課業" },
      { from: "課業", to: "期中" },
      { from: "期中", to: "未來" },
    ],
  });
}

export function researchTopicsFor(prompt: string) {
  if (!/淡江|大一|新生|淡水/.test(prompt)) return [];
  return [
    "校園",
    "社團",
    "交通",
    "生活",
    "淡水",
    "住宿",
    "餐飲",
    "新生活動",
    "校園地點",
    "學生議題",
  ];
}

export function roleLimit(count: number) {
  return Math.min(count, DEFAULT_BUDGET.audienceRoles);
}
