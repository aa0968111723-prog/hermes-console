import type { StructuredGoal, TaskFocus } from "../../contracts";
import { classifyIntent, isFastTier } from "./intent";

const TAMKANG = /淡江|淡水|克難坡|TKU|tku|教心所/;
const RESEARCH = /研究|查|搜|資料|文獻|最近|議題|來源/;
const DESIGN =
  /海報|網宣|Canva|canva|視覺|設計|稿|文宣|宣傳|做一張|視覺層級|構圖|配色/;
const ANALYZE =
  /這張|這圖|這份海報|分析這|哪裡可以改|哪裡要改|構圖|配色|視覺層級/;
const AUDIENCE = /受眾|新生角度|模擬|Twin|會喜歡|反向|路人會不會/;
const INSPIRATION = /靈感|參考|IG|Pinterest|instagram/i;
const OUTPUT = /海報|網宣|三個方向|Canva|文案|貼文|caption|限動|CTA|宣傳|文宣/;

export function interpretGoal(
  input: string,
  options?: { hasImage?: boolean; focus?: TaskFocus | null },
): StructuredGoal {
  const text = input.trim();
  let intentTier = classifyIntent(text, options);
  const focused = !!(options?.focus?.copyId || options?.focus?.workflowId);
  if (focused && isFastTier(intentTier)) intentTier = "create";
  const requiresImageAnalysis = ANALYZE.test(text) || !!options?.hasImage;
  const requiresTamkang = TAMKANG.test(text);
  const requiresResearch = RESEARCH.test(text) || requiresTamkang;
  const requiresDesign = DESIGN.test(text) || requiresImageAnalysis || focused;
  const requiresAudienceEvaluation =
    AUDIENCE.test(text) || requiresImageAnalysis;
  const requiresInspiration = INSPIRATION.test(text) || requiresDesign;
  const audience = requiresTamkang
    ? "淡江大一新生（模擬，不是民調）"
    : /受眾|學生/.test(text)
      ? "使用者提到的受眾（待確認）"
      : null;
  const output =
    OUTPUT.test(text) || requiresImageAnalysis || focused
      ? requiresImageAnalysis
        ? "看圖後的修改建議（模擬受眾，不是已改稿）"
        : "同一作品的下一版，不是無關的新輸出"
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
    requiresImageAnalysis,
    intentTier,
  };
}
