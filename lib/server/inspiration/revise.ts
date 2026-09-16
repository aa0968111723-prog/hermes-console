import type { DirectionBriefPack } from "../../direction-brief";

const TYPE_ENLARGE =
  /第二版|第\s*2\s*版|字放大|字再大|標題大|主標大|放大標題|字級加大|改大字/;
const CONTINUE_SAME_WORK =
  /接續修改同一作品|修改這個作品|繼續改這[個件]作品/;

export const CONTINUE_SAME_WORK_PROMPT = "請接續修改同一作品。";

export function isSpecRevisionRequest(text: string) {
  return TYPE_ENLARGE.test(text.trim());
}

export function isContinueSameWorkRequest(text: string) {
  return (
    CONTINUE_SAME_WORK.test(text.trim()) && !isSpecRevisionRequest(text)
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
