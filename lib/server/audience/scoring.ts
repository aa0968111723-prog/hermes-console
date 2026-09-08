import { clampScore } from "../audience";
import { EVAL_METRICS, SIMULATION, type EvalMetric, type EvaluationScores } from "./types";

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasLocalCue(text: string, ...parts: string[]) {
  const candidates = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map(escapeRegExp);
  return candidates.length > 0 && new RegExp(candidates.join("|")).test(text);
}

export function heuristicScores(input: {
  copy: string;
  audienceLocation: string;
  audienceInstitution: string;
}): EvaluationScores {
  const text = input.copy;
  const local = hasLocalCue(
    text,
    input.audienceLocation,
    input.audienceInstitution,
    "克難坡",
    "淡水",
    "公館",
  );
  const life = /朋友|社團|大一|迎新|茶會|生活|校園/.test(text);
  const jargon = /靜定|禪修|開示|法會/.test(text);
  const cta = /來參加|報名|時間|地點|週|點/.test(text);
  const ad = /限時|優惠|立即購買/.test(text);
  const scores = {
    stopIntent: jargon && !life ? 28 : life ? 62 : 44,
    comprehension: jargon ? 34 : 70,
    relevance: life ? 68 : 40,
    localRelevance: local ? 76 : 22,
    peerAffinity: life ? 64 : 30,
    emotionalConnection: life ? 58 : 36,
    credibility: 55,
    shareIntent: life && !jargon ? 60 : 32,
    clickIntent: cta ? 58 : 35,
    joinIntent: life && cta ? 61 : 33,
    ctaClarity: cta ? 72 : 28,
    informationLoad: text.length > 80 ? 64 : 42,
    adFeeling: ad ? 78 : 24,
    religiousDistance: jargon && !life ? 74 : jargon ? 48 : 18,
    freshness: local && life ? 57 : 41,
  } as Record<EvalMetric, number>;
  for (const key of EVAL_METRICS) scores[key] = clampScore(scores[key]);
  return { ...SIMULATION, scores };
}
