/**
 * Reverse-thinking pass: evaluate copy from bystander/skeptic first glance.
 * Heuristic simulation only — not conversionRate, CTR, or live respondents.
 */
import { AUDIENCE_DISCLAIMER, reverseThinkingTriggers, wantsReverseThinking } from "../audience.ts";
import { buildProfile } from "../audience/engine.ts";
import { evaluateArtifact, evaluationEnvelope } from "../audience/evaluation.ts";
import { debateFromEvaluations } from "../audience/debate.ts";
import {
  resolvePersonasForContext,
  simulateAudienceReaction,
} from "./engine.ts";
import type { AudienceSimulationResult, PersonaId, PersonaProfile } from "./types.ts";

export const REVERSE_ORDER: PersonaId[] = [
  "bystander",
  "skeptic",
  "target_freshman",
  "peer_advocate",
  "creative_director",
];

export interface ReversePerspective {
  personaId: PersonaId;
  name: string;
  prompt: string;
  firstGlance: string;
  wouldSwipeAway: boolean;
  swipeReason: string;
  keepReason: string;
  revisionAsk: string;
  sourceKind: "console_fixture";
}

export interface ReverseThinkingResult {
  triggered: boolean;
  triggers: string[];
  order: PersonaId[];
  perspectives: ReversePerspective[];
  simulatedEvaluation: AudienceSimulationResult;
  envelope: ReturnType<typeof evaluationEnvelope>;
  debate: ReturnType<typeof debateFromEvaluations>;
  swipeRisk: {
    score: number;
    label: "high" | "medium" | "low";
    method: "ai_heuristic";
    note: string;
  };
  recommendedRevisions: string[];
  simulation: true;
  method: "ai_heuristic";
  personaSource: "console_fixture";
  disclaimer: string;
}

function personaById(personas: PersonaProfile[], id: PersonaId) {
  return personas.find((item) => item.id === id) || personas[0];
}

function reversePromptFor(id: PersonaId, name: string) {
  if (id === "bystander") return `如果我是${name}，第一眼會不會直接滑掉？`;
  if (id === "skeptic") return `如果我是${name}，會不會覺得這在傳教或收費？`;
  if (id === "target_freshman") return `如果我是${name}，看得懂、敢去嗎？`;
  if (id === "peer_advocate") return `如果我是${name}，會轉傳給室友嗎？`;
  return `如果我是${name}，主標是否該改成生活場景？`;
}

export function runReverseThinkingEvaluation(input: {
  prompt?: string;
  conceptTitle: string;
  description?: string;
  visualNotes?: string;
  copyExcerpt?: string;
  projectId?: string;
  institution?: string;
  location?: string;
  forceTriggered?: boolean;
}): ReverseThinkingResult {
  const prompt = input.prompt || input.conceptTitle;
  const title = input.conceptTitle;
  const copy = [input.description, input.copyExcerpt].filter(Boolean).join("\n");
  const visual = input.visualNotes || "";
  const { domain, personas } = resolvePersonasForContext(
    `${prompt} ${title} ${copy}`,
    input.projectId,
  );
  const simulatedEvaluation = simulateAudienceReaction(
    title,
    input.description || "",
    visual,
    input.copyExcerpt || "",
    input.projectId,
  );
  const institution =
    input.institution ||
    (domain === "ntu" ? "國立臺灣大學" : domain === "tamkang" ? "淡江大學" : "大專院校");
  const location =
    input.location ||
    (domain === "ntu" ? "公館" : domain === "tamkang" ? "淡水" : "校園");
  const profile = buildProfile({
    projectId: input.projectId || "personal",
    institution,
    location,
    name: personas[0].name,
  });
  const roles = evaluateArtifact({
    profile,
    copy: copy || title,
    title,
  });
  const envelope = evaluationEnvelope(roles);
  const debate = debateFromEvaluations(roles);

  const perspectives: ReversePerspective[] = REVERSE_ORDER.map((id) => {
    const persona = personaById(personas, id);
    const feedback = simulatedEvaluation.feedback.find((item) => item.personaId === id);
    const role = roles.find((item) =>
      id === "bystander"
        ? item.role === "Bystander"
        : id === "skeptic"
          ? item.role === "Skeptic"
          : id === "target_freshman"
            ? item.role === "Target"
            : id === "peer_advocate"
              ? item.role === "Peer"
              : item.role === "CreativeDirector",
    );
    const wouldSwipeAway =
      id === "bystander"
        ? (feedback?.score || 0) < 70 || /滑掉/.test(feedback?.reaction || "")
        : id === "skeptic"
          ? (feedback?.score || 0) < 65 || (role?.objections.length || 0) > 0
          : false;
    return {
      personaId: id,
      name: persona.name,
      prompt: reversePromptFor(id, persona.name),
      firstGlance: feedback?.reaction || role?.firstReaction || "",
      wouldSwipeAway,
      swipeReason: wouldSwipeAway
        ? role?.dropOffReasons[0] || feedback?.critique || "第一眼不夠生活化或信任感不足（啟發式）"
        : "未判定為立即滑掉（啟發式，非實測停留秒數）",
      keepReason: role?.joinReasons[0] || feedback?.constructiveSuggestion || "需更多生活線索",
      revisionAsk: feedback?.constructiveSuggestion || role?.recommendedChanges[0] || debate.recommendedDirection,
      sourceKind: "console_fixture",
    };
  });

  const swipeCount = perspectives.filter((item) => item.wouldSwipeAway).length;
  const swipeScore = Math.max(0, Math.min(100, 20 + swipeCount * 28));
  const recommendedRevisions = [
    ...new Set(
      perspectives
        .map((item) => item.revisionAsk)
        .concat(debate.recommendedDirection)
        .filter(Boolean),
    ),
  ].slice(0, 5);

  return {
    triggered: Boolean(input.forceTriggered || wantsReverseThinking(prompt)),
    triggers: reverseThinkingTriggers(prompt),
    order: REVERSE_ORDER,
    perspectives,
    simulatedEvaluation,
    envelope,
    debate,
    swipeRisk: {
      score: swipeScore,
      label: swipeScore >= 70 ? "high" : swipeScore >= 40 ? "medium" : "low",
      method: "ai_heuristic",
      note: "Swipe risk is an AI heuristic from console personas, not a live dwell or click metric.",
    },
    recommendedRevisions,
    simulation: true,
    method: "ai_heuristic",
    personaSource: "console_fixture",
    disclaimer: AUDIENCE_DISCLAIMER,
  };
}

export { wantsReverseThinking, reverseThinkingTriggers };
