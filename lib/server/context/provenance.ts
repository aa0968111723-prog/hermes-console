import type { TruthClass } from "../certification/types";

export type ContextSourceKind =
  | "project"
  | "artifact"
  | "shared_memory"
  | "conversation"
  | "material"
  | "inspiration"
  | "creative_direction"
  | "artifact"
  | "audience"
  | "runtime"
  | "research_notes"
  | "goal";

export interface ContextItem {
  id: string;
  source: ContextSourceKind;
  title: string;
  content: string;
  recency: number;
  importance: number;
  relevance: number;
  confidence: number;
  truth: TruthClass;
  tokens: number;
  layer?: string;
  stale?: boolean;
}

export function estimateTokens(text: string) {
  let han = 0;
  let other = 0;
  for (const char of text) {
    if (/\p{Script=Han}/u.test(char)) han += 1;
    else other += 1;
  }
  // Han is typically ~1 token per character; latin ~4 characters per token.
  return Math.max(1, Math.ceil(han + other / 4));
}

export function recencyScore(iso?: string | null) {
  if (!iso) return 0.3;
  const age = Date.now() - Date.parse(iso);
  if (!Number.isFinite(age) || age < 0) return 0.3;
  const days = age / 86_400_000;
  if (days < 1) return 1;
  if (days < 7) return 0.8;
  if (days < 30) return 0.55;
  return 0.3;
}

export function decayingConfidence(
  stored: number | null | undefined,
  updatedAt?: string | null,
) {
  const base =
    typeof stored === "number" && Number.isFinite(stored) ? stored : 0.7;
  return Math.min(
    1,
    Math.max(0, Math.round(base * recencyScore(updatedAt) * 1000) / 1000),
  );
}
