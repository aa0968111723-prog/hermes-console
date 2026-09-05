import { jaccard } from "../inspiration/dedupe";
import type { EvaluationScores } from "../audience/types";

export interface RankableDirection {
  title: string;
  coreIdea?: string;
  claim: string;
  visual: string;
  copy: string;
  cta: string;
}

const WEIGHTS: Partial<Record<keyof EvaluationScores["scores"], number>> = {
  stopIntent: 1.2,
  comprehension: 1.3,
  relevance: 1.2,
  localRelevance: 1.4,
  peerAffinity: 1.1,
  joinIntent: 1.3,
  ctaClarity: 1.1,
  adFeeling: -0.8,
  religiousDistance: -0.6,
  informationLoad: -0.4,
};

export function weightedScore(scores: EvaluationScores["scores"]) {
  let total = 0,
    weight = 0;
  for (const [key, value] of Object.entries(WEIGHTS)) {
    total += scores[key as keyof typeof scores] * (value || 0);
    weight += Math.abs(value || 0);
  }
  return Math.round(total / (weight || 1));
}

export function diversityWarnings(directions: RankableDirection[]) {
  const warnings: string[] = [];
  for (let i = 0; i < directions.length; i++)
    for (let j = i + 1; j < directions.length; j++) {
      const sim = jaccard(
        directions[i].title + " " + directions[i].claim + " " + directions[i].visual,
        directions[j].title + " " + directions[j].claim + " " + directions[j].visual,
      );
      if (sim >= 0.72)
        warnings.push(
          `方向 ${i + 1} 與 ${j + 1} 策略過於相近（similarity ${sim.toFixed(2)}）。`,
        );
    }
  return warnings;
}

export function rankDirections(input: {
  directions: RankableDirection[];
  scores: EvaluationScores["scores"][];
}) {
  const ranked = input.directions.map((direction, index) => ({
    index,
    direction,
    score: weightedScore(input.scores[index] || input.scores[0]),
  }));
  ranked.sort((a, b) => b.score - a.score);
  return {
    ranking: ranked,
    diversity: diversityWarnings(input.directions),
    hardWarnings: ranked
      .filter((item) => item.score < 35)
      .map((item) => `方向 ${item.index + 1} 模擬分數偏低，需改寫主標。`),
  };
}

export function creativeFingerprint(club: string, copy: string) {
  const zen = /禪|靜定|茶會/.test(copy);
  const photo = /攝影|鏡頭|快門/.test(copy);
  return { club, zen, photo, generic: zen === photo };
}
