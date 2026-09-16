import type { StructuredGoal, TaskFocus } from "../../contracts";
import { classifyIntent } from "./intent";

const TAMKANG = /淡江|淡大|淡水|克難坡|TKU|tku|教心所/;
const RESEARCH = /研究|查|搜|資料|文獻|最近|議題|來源/;
const DESIGN = /海報|網宣|Canva|canva|視覺|設計|稿/;
const AUDIENCE = /受眾|新生角度|模擬|Twin|會喜歡|可能喜歡|反向|路人會不會/;
const INSPIRATION = /靈感|參考|IG|Pinterest|instagram/i;
const OUTPUT = /海報|網宣|三個方向|Canva|文案|貼文|caption|限動|CTA/;
const LOCAL_NOTES =
  /研究筆記|MoE|CUDA|KV.?cache|multimodal encoder|Agent Runtime|knowledge graph/i;
const IMAGE =
  /分析(這張|這份|圖片|海報|文宣)|這張哪裡|哪裡可以改|看圖|構圖|配色|視覺層級|資訊層級|版本差|請分析這/;
const MAKING = /幫我做|做一張|製作|出圖/;
const MAKING_VISUAL = /文宣|海報|網宣|宣傳|IG|限動|貼文/;

export function wantsNewVisual(text: string): boolean {
  return DESIGN.test(text.trim()) || (MAKING.test(text) && MAKING_VISUAL.test(text));
}

export function interpretGoal(
  input: string,
  extras: {
    hasAttachments?: boolean;
    hasImage?: boolean;
    focus?: TaskFocus | null;
  } = {},
): StructuredGoal {
  const text = input.trim();
  const artifactFocused = !!(extras.focus?.copyId || extras.focus?.workflowId);
  const focused = artifactFocused || !!extras.focus?.activityId;
  let intentTier = classifyIntent(text);
  if (focused && (intentTier === "chitchat" || intentTier === "continue"))
    intentTier = "create";
  const hasAttachments = !!(extras.hasAttachments || extras.hasImage);
  const requiresTamkang = TAMKANG.test(text);
  const requiresImageAnalysis =
    IMAGE.test(text) || (hasAttachments && !MAKING.test(text));
  const requiresResearch = RESEARCH.test(text) || requiresTamkang;
  const wantsVisual =
    DESIGN.test(text) || (MAKING.test(text) && MAKING_VISUAL.test(text));
  const requiresDesign =
    focused || (wantsVisual && (MAKING.test(text) || !requiresImageAnalysis));
  const requiresAudienceEvaluation =
    AUDIENCE.test(text) || requiresImageAnalysis;
  const requiresInspiration = INSPIRATION.test(text) || requiresDesign;
  const requiresLocalNotes = LOCAL_NOTES.test(text) && !requiresTamkang;
  const audience = requiresTamkang
    ? "淡江大一新生（模擬，不是民調）"
    : /受眾|學生/.test(text)
      ? "使用者提到的受眾（待確認）"
      : null;
  const output = artifactFocused
    ? "同一作品的下一版，不是無關的新輸出"
    : extras.focus?.activityId
      ? "依此活動提出方向，不是無關的新企劃"
      : requiresImageAnalysis
        ? "看圖、視覺層級與修改建議（受眾為模擬）"
        : OUTPUT.test(text)
          ? "可審查的創作方向與 Canva 接續草稿"
          : null;
  const constraints: string[] = [];
  if (requiresAudienceEvaluation)
    constraints.push("Audience Twin 只能標 SIMULATION。");
  if (requiresResearch)
    constraints.push("沒有外部 evidence 不得宣稱研究已完成。");
  if (requiresDesign) constraints.push("Canva 未授權時不得假裝設計成功。");
  if (requiresImageAnalysis)
    constraints.push("沒有真實圖片內容不得假裝已看圖；PDF 未抽取不得把檔名當內容。");
  if (requiresLocalNotes)
    constraints.push("倉庫研究筆記不是外部驗證，也不是已部署能力。");
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
    requiresLocalNotes,
    requiresImageAnalysis,
    hasAttachments,
    intentTier,
  };
}
