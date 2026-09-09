import type { StructuredGoal } from "../../contracts";
import type { AssistantMode } from "../../assistant-modes";
import { specialistInstructions } from "../../assistant-modes";
import { isFramelabIntent, isLumenIntent } from "../projects/router";
import {
  AUDIENCE_INSTRUCTION_PACK,
  BASE_CREATIVE_INSTRUCTIONS,
  CANVA_INSTRUCTION_PACK,
  COPYWRITING_INSTRUCTION_PACK,
  DIRECTION_INSTRUCTION_PACK,
  VISUAL_INSTRUCTION_PACK,
  FAST_TASK_INSTRUCTIONS,
  FRAMELAB_INSTRUCTION_PACK,
  GALLEY_INSTRUCTION_PACK,
  INSPIRATION_INSTRUCTION_PACK,
  LUMEN_INSTRUCTION_PACK,
  PLANFORM_INSTRUCTION_PACK,
  TAMKANG_INSTRUCTION_PACK,
  TRUTH_QA_INSTRUCTION_PACK,
  WORKSPACE_INSTRUCTION_PACK,
  ZENCLUB_INSTRUCTION_PACK,
} from "../hermes";
import { needsZenclubKnowledge } from "../zenclub";
import { isFastTier, type IntentTier } from "./intent";

export type InstructionPackId =
  | "fast"
  | "base"
  | "workspace"
  | "tamkang"
  | "zenclub"
  | "galley"
  | "inspiration"
  | "audience"
  | "visual"
  | "copywriting"
  | "canva"
  | "lumen"
  | "framelab"
  | "planform"
  | "truth"
  | "research"
  | "admin";

export function composeTaskInstructions(input: {
  mode: AssistantMode;
  text: string;
  goal: StructuredGoal;
  intentTier?: IntentTier;
}) {
  const tier = input.intentTier || input.goal.intentTier;
  const specialist = specialistInstructions(input.mode);
  if (isFastTier(tier)) {
    return {
      instructions: specialist || FAST_TASK_INSTRUCTIONS,
      packs: ["fast"] as InstructionPackId[],
      includeLumenManual: false,
      includeFramelabManual: false,
    };
  }
  if (specialist) {
    return {
      instructions: specialist,
      packs: [input.mode === "admin" ? "admin" : "research"] as InstructionPackId[],
      includeLumenManual: false,
      includeFramelabManual: false,
    };
  }

  const packs: InstructionPackId[] = ["base", "workspace"];
  const parts = [BASE_CREATIVE_INSTRUCTIONS, WORKSPACE_INSTRUCTION_PACK];
  if (needsZenclubKnowledge(input.text) || needsZenclubKnowledge(input.goal.goal)) {
    parts.push(ZENCLUB_INSTRUCTION_PACK);
    packs.push("zenclub");
  }
  if (input.goal.requiresTamkang) {
    parts.push(TAMKANG_INSTRUCTION_PACK);
    packs.push("tamkang");
  }
  if (input.goal.requiresInspiration || input.goal.requiresDesign) {
    parts.push(GALLEY_INSTRUCTION_PACK, INSPIRATION_INSTRUCTION_PACK);
    packs.push("galley", "inspiration");
  }
  if (input.goal.requiresAudienceEvaluation) {
    parts.push(AUDIENCE_INSTRUCTION_PACK);
    packs.push("audience");
  }
  if (
    input.goal.requiresDesign ||
    input.goal.output ||
    /文案|caption|限動|Reels|reel|CTA|私訊|表單說明|hook|招生文案|海報標題/.test(
      input.text,
    )
  ) {
    parts.push(COPYWRITING_INSTRUCTION_PACK);
    packs.push("copywriting");
  }
  if (input.goal.requiresDesign || input.goal.output) {
    parts.push(
      VISUAL_INSTRUCTION_PACK,
      DIRECTION_INSTRUCTION_PACK,
      CANVA_INSTRUCTION_PACK,
    );
    packs.push("visual", "canva");
  }
  const includeLumenManual = isLumenIntent(input.text);
  const includeFramelabManual = isFramelabIntent(input.text);
  if (includeLumenManual) {
    parts.push(LUMEN_INSTRUCTION_PACK);
    packs.push("lumen");
  }
  if (includeFramelabManual) {
    parts.push(FRAMELAB_INSTRUCTION_PACK);
    packs.push("framelab");
  }
  if (/場佈|教室|攤位|門口淨空|planform/i.test(input.text)) {
    parts.push(PLANFORM_INSTRUCTION_PACK);
    packs.push("planform");
  }
  if (
    input.goal.requiresTamkang ||
    input.goal.requiresDesign ||
    /禪學社|文案|海報|貼文|報名|茶會|社博|講師|活動名稱|限時動態/.test(input.text)
  ) {
    parts.push(TRUTH_QA_INSTRUCTION_PACK);
    packs.push("truth");
  }
  return {
    instructions: parts.join("\n"),
    packs,
    includeLumenManual,
    includeFramelabManual,
  };
}

export function dropOptionalPacks(composed: ReturnType<typeof composeTaskInstructions>) {
  if (composed.packs.includes("fast") || composed.packs.includes("research") || composed.packs.includes("admin"))
    return composed;
  return {
    instructions: [BASE_CREATIVE_INSTRUCTIONS, WORKSPACE_INSTRUCTION_PACK].join(
      "\n",
    ),
    packs: ["base", "workspace"] as InstructionPackId[],
    includeLumenManual: false,
    includeFramelabManual: false,
  };
}
