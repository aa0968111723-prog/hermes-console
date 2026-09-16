import type { DirectionBriefPack } from "../../direction-brief";

const TYPE_ENLARGE =
  /第二版|第\s*2\s*版|字放大|字再大|標題大|主標大|放大標題|字級加大|改大字/;

export function isSpecRevisionRequest(text: string) {
  return TYPE_ENLARGE.test(text.trim());
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
