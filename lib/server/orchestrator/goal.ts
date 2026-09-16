import type { StructuredGoal, TaskFocus } from "../../contracts";
import { isLumenIntent } from "../projects/router";
import {
  IMAGE_CRITIQUE,
  classifyIntent,
  isFastTier,
} from "./intent";

const TAMKANG = /淡江|淡大|淡水|克難坡|TKU|tku|教心所/;
const RESEARCH = /研究|查|搜|資料|文獻|最近|議題|來源/;
const DESIGN = /海報|網宣|Canva|canva|視覺|設計|稿/;
const AUDIENCE = /受眾|新生角度|模擬|Twin|會喜歡|反向|路人會不會/;
const INSPIRATION = /靈感|參考|IG|Pinterest|instagram/i;
const OUTPUT = /海報|網宣|三個方向|Canva|文案|貼文|caption|限動|CTA/;

const CN: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

export type GoalExtras = {
  attachmentCount?: number;
  imageAttachmentCount?: number;
  attachmentIds?: string[];
  hasImage?: boolean;
  hasAttachments?: boolean;
  focus?: TaskFocus | null;
};

export function wantsNewVisual(text: string): boolean {
  return DESIGN.test(text.trim());
}

function chineseToInt(raw: string): number | null {
  if (raw === "十") return 10;
  if (raw.startsWith("十") && raw.length === 2) {
    const ones = CN[raw[1]];
    return ones ? 10 + ones : null;
  }
  if (raw.endsWith("十") && raw.length === 2) {
    const tens = CN[raw[0]];
    return tens && tens < 10 ? tens * 10 : null;
  }
  if (raw.length === 1) return CN[raw] ?? null;
  return null;
}

export function parseTargetRevision(text: string): string | null {
  const numbered = text.match(/第(\d+)版/);
  if (numbered) return "v" + Number(numbered[1]);
  const chinese = text.match(/第([一二三四五六七八九十]+)版/);
  if (chinese) {
    const n = chineseToInt(chinese[1]);
    if (n) return "v" + n;
  }
  const latin = text.match(/\b[vV](\d+)\b/);
  return latin ? "v" + latin[1] : null;
}

export function interpretGoal(
  input: string,
  extras: GoalExtras = {},
): StructuredGoal {
  const text = input.trim();
  const imageCount =
    extras.imageAttachmentCount ??
    (extras.hasImage || extras.hasAttachments ? 1 : 0);
  const attachmentCount = extras.attachmentCount ?? imageCount;
  const imageCritique = IMAGE_CRITIQUE.test(text);
  const targetRevision = parseTargetRevision(text);
  const artifactFocused = !!(extras.focus?.copyId || extras.focus?.workflowId);
  const focused = artifactFocused || !!extras.focus?.activityId;
  let intentTier = classifyIntent(text);
  if (
    (imageCount > 0 || Boolean(targetRevision) || focused) &&
    isFastTier(intentTier)
  )
    intentTier = "create";
  const requiresTamkang = TAMKANG.test(text);
  const requiresResearch = RESEARCH.test(text) || requiresTamkang;
  const requiresDesign = DESIGN.test(text) || focused;
  const requiresAudienceEvaluation =
    AUDIENCE.test(text) || (imageCritique && imageCount > 0);
  const requiresInspiration = INSPIRATION.test(text) || requiresDesign;
  const requiresImageRead =
    imageCount > 0 || (attachmentCount > 0 && imageCritique);
  const requiresLumen = isLumenIntent(text);
  const audience = requiresTamkang
    ? "淡江大一新生（模擬，不是民調）"
    : /受眾|學生/.test(text)
      ? "使用者提到的受眾（待確認）"
      : imageCritique && imageCount > 0
        ? "依畫面推估的目標客群（模擬，不是民調）"
        : null;
  const output = artifactFocused
    ? "同一作品的下一版，不是無關的新輸出"
    : extras.focus?.activityId
      ? "依此活動提出方向，不是無關的新企劃"
      : OUTPUT.test(text)
        ? "可審查的創作方向與 Canva 接續草稿"
        : null;
  const constraints: string[] = [];
  if (requiresAudienceEvaluation)
    constraints.push("Audience Twin 只能標 SIMULATION。");
  if (requiresResearch)
    constraints.push("沒有外部 evidence 不得宣稱研究已完成。");
  if (requiresDesign) constraints.push("Canva 未授權時不得假裝設計成功。");
  if (requiresImageRead) {
    constraints.push("必須先讀已上傳素材，不得只依檔名評論。");
    const ids = (extras.attachmentIds || []).filter(Boolean).slice(0, 4);
    if (ids.length)
      constraints.push("素材 ID：" + ids.join("、"));
  }
  if (targetRevision)
    constraints.push(
      "必須針對 " + targetRevision + " 修改，不得重新生成不相關作品。",
    );
  if (requiresLumen)
    constraints.push("Lumen 未設定或不可用時不得假裝已開畫板。");
  return {
    goal: text.slice(0, 500),
    audience,
    output,
    constraints,
    requiresResearch,
    requiresDesign,
    requiresAudienceEvaluation,
    requiresTamkang,
    requiresInspiration,
    requiresImageRead,
    requiresLumen,
    targetRevision,
    requiresImageAnalysis: requiresImageRead,
    requiresImageReview: requiresImageRead,
    intentTier,
  };
}

/** Spoken create asks still get workspace cards when Hermes is unconfigured. */
export function wantsWorkspaceInspiration(goal: StructuredGoal): boolean {
  if (goal.directionLocked || goal.requiresImageReview) return false;
  if (goal.intentTier === "lookup") return goal.requiresInspiration;
  if (goal.requiresInspiration || goal.requiresDesign) return true;
  return goal.intentTier === "create" && hasCreateCue(goal.goal);
}

/** Club fact questions use the Drive index snapshot, not a poster mill. */
export function wantsWorkspaceKnowledge(goal: StructuredGoal): boolean {
  if (goal.directionLocked || goal.requiresImageReview) return false;
  if (goal.intentTier === "chitchat") return false;
  if (wantsWorkspaceInspiration(goal)) return false;
  return needsZenclubKnowledge(goal.goal);
}

/** Spoken audience asks still get the freshman twin without pretending to see a poster. */
export function wantsWorkspaceAudience(goal: StructuredGoal): boolean {
  if (goal.directionLocked || goal.requiresImageReview) return false;
  if (goal.requiresImageAnalysis) return false;
  if (wantsWorkspaceInspiration(goal) || wantsWorkspaceKnowledge(goal)) return false;
  return goal.requiresAudienceEvaluation;
}
