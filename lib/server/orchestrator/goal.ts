import type { StructuredGoal, TaskFocus } from "../../contracts";
import { isDirectionPick } from "../../inspiration-pack";
import { classifyIntent, hasCreateCue } from "./intent";

const TAMKANG = /淡江|淡大|淡水|克難坡|TKU|tku|教心所/;
const RESEARCH = /研究|查|搜|資料|文獻|最近|議題|來源/;
const STRONG_DESIGN =
  /海報|網宣|Canva|canva|視覺|設計|稿|文宣|做一張|視覺層級|構圖|配色/;
const AUDIENCE = /受眾|新生角度|模擬|Twin|會喜歡|反向|路人會不會/;
const INSPIRATION = /靈感|參考|IG|Pinterest|instagram/i;
const OUTPUT = /海報|網宣|三個方向|Canva|文案|貼文|caption|限動|CTA|宣傳|文宣/;
const IMAGE_REVIEW = /這張(圖|海報|稿|設計)?|哪裡可以改|視覺層級|分析這[張個]/;
const ANALYZE =
  /這張|這圖|這份海報|分析這|哪裡可以改|哪裡要改|構圖|配色|視覺層級/;

export function userFacingGoalText(input: string) {
  const index = input.indexOf("BEGIN_UNTRUSTED_DATA");
  return (index >= 0 ? input.slice(0, index) : input).trim();
}

export function wantsNewVisual(text: string): boolean {
  return STRONG_DESIGN.test(text.trim());
}

export function interpretGoal(
  input: string,
  options?: { hasImage?: boolean; focus?: TaskFocus | null },
): StructuredGoal {
  const text = userFacingGoalText(input);
  const artifactFocused = !!(
    options?.focus?.copyId || options?.focus?.workflowId
  );
  const focused = artifactFocused || !!options?.focus?.activityId;
  let intentTier = classifyIntent(text, options);
  if (focused && (intentTier === "chitchat" || intentTier === "continue"))
    intentTier = "create";
  const directionLocked = isDirectionPick(text);
  const imageReview =
    !directionLocked && (IMAGE_REVIEW.test(text) || ANALYZE.test(text));
  const requiresImageAnalysis =
    imageReview || !!options?.hasImage || ANALYZE.test(text);
  const requiresTamkang = !directionLocked && TAMKANG.test(text);
  const requiresResearch =
    !directionLocked && (RESEARCH.test(text) || requiresTamkang);
  const inspirationOnly =
    INSPIRATION.test(text) &&
    !STRONG_DESIGN.test(text) &&
    !imageReview &&
    !directionLocked &&
    !focused;
  const requiresDesign =
    !inspirationOnly &&
    (STRONG_DESIGN.test(text) ||
      /宣傳/.test(text) ||
      imageReview ||
      directionLocked ||
      focused);
  const requiresAudienceEvaluation =
    !directionLocked && (AUDIENCE.test(text) || imageReview || requiresImageAnalysis);
  const requiresInspiration = directionLocked
    ? false
    : imageReview
      ? false
      : INSPIRATION.test(text) || requiresDesign;
  const audience = requiresTamkang
    ? "淡江大一新生（模擬，不是民調）"
    : /受眾|學生/.test(text)
      ? "使用者提到的受眾（待確認）"
      : null;
  const output = inspirationOnly
    ? null
    : OUTPUT.test(text) || requiresImageAnalysis || focused
      ? requiresImageAnalysis
        ? "看圖後的修改建議（模擬受眾，不是已改稿）"
        : artifactFocused
          ? "同一作品的下一版，不是無關的新輸出"
          : options?.focus?.activityId
            ? "依此活動提出方向，不是無關的新企劃"
            : OUTPUT.test(text)
              ? "可審查的創作方向與 Canva 接續草稿"
              : "依此活動提出方向，不是無關的新企劃"
      : null;
  const constraints: string[] = [];
  if (requiresAudienceEvaluation)
    constraints.push("Audience Twin 只能標 SIMULATION。");
  if (requiresResearch)
    constraints.push("沒有外部 evidence 不得宣稱研究已完成。");
  if (requiresDesign) constraints.push("Canva 未授權時不得假裝設計成功。");
  if (requiresImageAnalysis)
    constraints.push("沒有讀到附件像素時必須標未讀圖，不得假裝已分析畫面。");
  return {
    goal: text.slice(0, 500) || (options?.hasImage ? "請分析這張附件。" : ""),
    audience,
    output,
    constraints,
    requiresResearch,
    requiresDesign,
    requiresAudienceEvaluation,
    requiresTamkang,
    requiresInspiration,
    requiresImageReview: imageReview,
    requiresImageAnalysis,
    directionLocked,
    intentTier,
  };
}

/** Spoken create/Tamkang asks still get workspace cards when Hermes is unconfigured. */
export function wantsWorkspaceInspiration(goal: StructuredGoal): boolean {
  if (goal.directionLocked || goal.requiresImageReview) return false;
  if (goal.requiresInspiration || goal.requiresDesign) return true;
  if (!hasCreateCue(goal.goal)) return false;
  return goal.intentTier === "create" || goal.requiresTamkang;
}
