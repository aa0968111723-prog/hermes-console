/**
 * Audience Twin (受眾雙生模擬) 類型定義
 */

export type PersonaId =
  | "target_freshman"
  | "bystander"
  | "skeptic"
  | "peer_advocate"
  | "creative_director";

export interface PersonaProfile {
  id: PersonaId;
  name: string;
  tag: string;
  role: string;
  avatar: string;
  perspective: string;
  mindset: string;
  triggers: string[];
  dislikes: string[];
}

export interface AudienceScore {
  stopIntent: number;    // 拇指停留率 (0-100)
  relevance: number;     // 痛點關聯度 (0-100)
  peerAffinity: number;  // 同儕轉傳率 (0-100)
  ctaClarity: number;    // 行動清晰度 (0-100)
  safetyIndex: number;   // 無壓信賴感 (0-100)
  overallScore: number;  // 綜合加權評分 (0-100)
}

export interface PersonaFeedback {
  personaId: PersonaId;
  name: string;
  avatar: string;
  score: number;
  reaction: string;
  critique: string;
  constructiveSuggestion: string;
}

export interface AudienceSimulationResult {
  conceptTitle: string;
  scores: AudienceScore;
  feedback: PersonaFeedback[];
  debateSummary: string;
  consensus: "strongly_recommended" | "recommended" | "needs_iteration";
  evidencePoints: string[];   // 真實證據 (Evidence)
  hypothesisPoints: string[]; // 推論假設 (Hypothesis)
  disclaimer: string;         // AI 模擬免責聲明
}
