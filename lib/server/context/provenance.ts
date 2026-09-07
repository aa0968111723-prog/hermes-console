import type { TruthClass } from "../certification/types";

export type ContextSourceKind =
  | "project"
  | "shared_memory"
  | "conversation"
  | "material"
  | "inspiration"
  | "creative_direction"
  | "audience"
  | "runtime"
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
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 3));
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
