import type { StructuredGoal, TaskFocus } from "../../contracts";
import type { AssistantMode } from "../../assistant-modes";
import { specialistInstructions } from "../../assistant-modes";
import { isFramelabIntent, isLumenIntent } from "../projects/router";
import {
  AUDIENCE_INSTRUCTION_PACK,
  BASE_CREATIVE_INSTRUCTIONS,
  CANVA_INSTRUCTION_PACK,
  COPYWRITING_INSTRUCTION_PACK,
  DIRECTION_INSTRUCTION_PACK,
  LOCKED_DIRECTION_INSTRUCTION_PACK,
  IMAGE_REVIEW_PACK,
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
  | "locked"
  | "audience"
  | "image"
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
  hasImageAttachments?: boolean;
}) {
  const tier = input.intentTier || input.goal.intentTier;
  const specialist = specialistInstructions(input.mode);
  if (isFastTier(tier) && !input.hasImageAttachments) {
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
  if (
    !input.goal.requiresImageReview &&
    (input.goal.requiresInspiration ||
      (input.goal.requiresDesign && !input.goal.directionLocked))
  ) {
    parts.push(GALLEY_INSTRUCTION_PACK, INSPIRATION_INSTRUCTION_PACK);
    packs.push("galley", "inspiration");
  }
  if (input.goal.requiresAudienceEvaluation) {
    parts.push(AUDIENCE_INSTRUCTION_PACK);
    packs.push("audience");
  }
  const imageReview =
    input.goal.requiresImageReview || Boolean(input.hasImageAttachments);
  if (imageReview) {
    parts.push(IMAGE_REVIEW_PACK);
    packs.push("image");
    if (!packs.includes("audience")) {
      parts.push(AUDIENCE_INSTRUCTION_PACK);
      packs.push("audience");
    }
    if (!packs.includes("visual")) {
      parts.push(VISUAL_INSTRUCTION_PACK);
      packs.push("visual");
    }
  }
  if (
    !input.goal.requiresImageReview &&
    (input.goal.requiresDesign ||
      input.goal.output ||
      /文案|caption|限動|Reels|reel|CTA|私訊|表單說明|hook|招生文案|海報標題/.test(
        input.text,
      ))
  ) {
    parts.push(COPYWRITING_INSTRUCTION_PACK);
    packs.push("copywriting");
  }
  if (
    !input.goal.requiresImageReview &&
    (input.goal.requiresDesign || input.goal.output)
  ) {
    parts.push(VISUAL_INSTRUCTION_PACK);
    if (input.goal.directionLocked) {
      parts.push(LOCKED_DIRECTION_INSTRUCTION_PACK);
      packs.push("locked");
    } else {
      parts.push(DIRECTION_INSTRUCTION_PACK);
    }
    parts.push(CANVA_INSTRUCTION_PACK);
    packs.push("visual", "canva");
  }
  const includeLumenManual =
    !input.goal.directionLocked && isLumenIntent(input.text);
  const includeFramelabManual =
    !input.goal.directionLocked && isFramelabIntent(input.text);
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
  const packs: InstructionPackId[] = ["base", "workspace"];
  const parts = [BASE_CREATIVE_INSTRUCTIONS, WORKSPACE_INSTRUCTION_PACK];
  if (composed.packs.includes("locked")) {
    parts.push(LOCKED_DIRECTION_INSTRUCTION_PACK);
    packs.push("locked");
  }
  return {
    instructions: parts.join("\n"),
    packs,
    includeLumenManual: false,
    includeFramelabManual: false,
  };
}

export function focusInstructions(focus?: TaskFocus | null) {
  if (!focus || (!focus.copyId && !focus.workflowId && !focus.activityId))
    return "";
  const parts = ["使用者要接續同一作品或活動，禁止重建無關輸出。"];
  if (focus.copyId)
    parts.push(
      "呼叫 workspace_get_copy，copyId=" +
        focus.copyId +
        (focus.revision ? "，以 v" + focus.revision + " 為修改基礎" : "") +
        "。沿用相同 id 與最新 expectedRevision 保存新版本。",
    );
  if (focus.workflowId)
    parts.push(
      "查回創作流程 " +
        focus.workflowId +
        " 的現有設計與選定方向。已有設計時先查回，不要重複建立。",
    );
  if (focus.activityId)
    parts.push(
      "呼叫 workspace_project_context 讀取活動 activityId=" +
        focus.activityId +
        "。依已確認資訊提出三個方向並保存，等待使用者選擇。私人資訊不得用於公開文宣。",
    );
  if (focus.direction)
    parts.push(
      "使用者已選定方向 " +
        focus.direction +
        "。依此方向查詢可用 Canva 範本欄位製作；缺授權請保留阻塞點，不要宣稱完成。",
    );
  return parts.join("");
}
