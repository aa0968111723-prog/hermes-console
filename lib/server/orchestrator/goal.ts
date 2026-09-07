import type { StructuredGoal } from "../../contracts";

const TAMKANG = /淡江|淡水|克難坡|TKU|tku|教心所|大一新生|新生茶會/;
const RESEARCH = /研究|查|搜|資料|文獻|最近|議題|來源/;
const DESIGN = /海報|網宣|Canva|canva|視覺|設計|稿/;
const AUDIENCE = /受眾|新生角度|模擬|Twin|會喜歡|受眾/;
const INSPIRATION = /靈感|參考|IG|Pinterest|instagram/i;
const OUTPUT = /海報|網宣|三個方向|Canva|文案|貼文/;

export function interpretGoal(input: string): StructuredGoal {
  const text = input.trim();
  const requiresTamkang = TAMKANG.test(text);
  const requiresResearch = RESEARCH.test(text) || requiresTamkang;
  const requiresDesign = DESIGN.test(text);
  const requiresAudienceEvaluation = AUDIENCE.test(text);
  const requiresInspiration = INSPIRATION.test(text) || requiresDesign;
  const audience = requiresTamkang
    ? "淡江大一新生（模擬，不是民調）"
    : /受眾|學生/.test(text)
      ? "使用者提到的受眾（待確認）"
      : null;
  const output = OUTPUT.test(text)
    ? "可審查的創作方向與 Canva 接續草稿"
    : null;
  const constraints: string[] = [];
  if (requiresAudienceEvaluation)
    constraints.push("Audience Twin 只能標 SIMULATION。");
  if (requiresResearch)
    constraints.push("沒有外部 evidence 不得宣稱研究已完成。");
  if (requiresDesign) constraints.push("Canva 未授權時不得假裝設計成功。");
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
  };
}
