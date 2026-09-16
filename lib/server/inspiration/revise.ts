import type { DirectionBriefPack } from "../../direction-brief";

const TYPE_ENLARGE =
  /第二版|第\s*2\s*版|字放大|字再大|標題大|主標大|放大標題|字級加大|改大字/;
const CONTINUE_SAME_WORK =
  /接續修改同一作品|修改這個作品|繼續改這[個件]作品/;
const MAKE_SELECTED_POSTER =
  /出圖|做(成|一張)?.{0,8}海報|做(成|一張)?.{0,8}網宣|做成?\s*Canva|幫我做海報|幫我做一張/;
const NEW_DIRECTION = /再找|換方向|其他方向|重新找|再找靈感|找靈感/;

export const CONTINUE_SAME_WORK_PROMPT = "請接續修改同一作品。";

export function isSpecRevisionRequest(text: string) {
  return TYPE_ENLARGE.test(text.trim());
}

export function isMakeSelectedPosterRequest(text: string) {
  const value = text.trim();
  if (!value || NEW_DIRECTION.test(value)) return false;
  return MAKE_SELECTED_POSTER.test(value);
}

export function isContinueSameWorkRequest(text: string) {
  const value = text.trim();
  return (
    (CONTINUE_SAME_WORK.test(value) || isMakeSelectedPosterRequest(value)) &&
    !isSpecRevisionRequest(value)
  );
}

export function applyTypeEnlarge(brief: DirectionBriefPack): DirectionBriefPack {
  if (brief.visualNote?.includes("主標加大")) return brief;
  return {
    ...brief,
    visualNote: "主標加大。規則修訂，不是出圖。",
    formats: brief.formats.map((format) => ({
      ...format,
      compositionHint: format.compositionHint.includes("主標加大")
        ? format.compositionHint
        : "主標加大。" + format.compositionHint,
    })),
  };
}
