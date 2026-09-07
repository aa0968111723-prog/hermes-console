export const SIMULATION = {
  simulation: true as const,
  method: "rule_heuristic" as const,
  disclaimer: "規則式模擬評估，未呼叫 AI 模型，不代表真實市場調查。",
};

export const EVAL_METRICS = [
  "stopIntent",
  "comprehension",
  "relevance",
  "localRelevance",
  "peerAffinity",
  "emotionalConnection",
  "credibility",
  "shareIntent",
  "clickIntent",
  "joinIntent",
  "ctaClarity",
  "informationLoad",
  "adFeeling",
  "religiousDistance",
  "freshness",
] as const;

export type EvalMetric = (typeof EVAL_METRICS)[number];

export const AUDIENCE_ROLES = [
  "Target",
  "Bystander",
  "Skeptic",
  "Peer",
  "CreativeDirector",
] as const;

export type AudienceRole = (typeof AUDIENCE_ROLES)[number];

export interface AudienceProfile {
  id: string;
  projectId: string;
  name: string;
  description: string;
  location: string;
  institution: string;
  ageRange: string;
  lifeStage: string;
  goals: string[];
  needs: string[];
  painPoints: string[];
  fears: string[];
  questions: string[];
  socialContext: string[];
  dailyScenes: string[];
  mediaHabits: string[];
  decisionTriggers: string[];
  scrollTriggers: string[];
  rejectionTriggers: string[];
  evidenceIds: string[];
  hypotheses: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AudienceEvidence {
  id: string;
  audienceId: string;
  claim: string;
  sourceId: string;
  confidence: number;
  category: string;
  createdAt: string;
}

export interface AudienceHypothesis {
  id: string;
  audienceId: string;
  statement: string;
  basis: string;
  confidence: number;
  status: "active" | "rejected" | "validated";
}

export interface GraphNode {
  id: string;
  label: string;
  kind: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  sourceId: string | null;
}

export interface EvaluationScores {
  simulation: true;
  method: "rule_heuristic";
  disclaimer: string;
  scores: Record<EvalMetric, number>;
}

export interface RoleEvaluation {
  role: AudienceRole;
  firstReaction: string;
  positiveSignals: string[];
  questions: string[];
  objections: string[];
  dropOffReasons: string[];
  shareReasons: string[];
  joinReasons: string[];
  recommendedChanges: string[];
  scores: EvaluationScores;
  confidence: number;
  sources: string[];
}
