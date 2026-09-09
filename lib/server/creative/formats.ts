export const COPY_FORMATS = ["post", "carousel", "story", "reel"] as const;
export type CopyFormat = (typeof COPY_FORMATS)[number];

export const VISUAL_FORMAT_IDS = [
  "ig_feed_4x5",
  "ig_story",
  "ig_reels_cover",
  "ig_carousel_4x5",
  "poster_a4",
  "poster_a3",
] as const;
export type VisualFormatId = (typeof VISUAL_FORMAT_IDS)[number];

export type VisualFormat = {
  id: VisualFormatId;
  label: string;
  platform: "instagram" | "print";
  role: "feed" | "story" | "reels_cover" | "carousel" | "poster";
  width: number;
  height: number;
  aspect: string;
  unit: "px";
  dpi: number | null;
  print: "A4" | "A3" | null;
  compositionHint: string;
  sceneKeywords: string[];
  textCoverageMaxPct: number;
  cropSafe: { x: number; y: number; width: number; height: number } | null;
  uiSafe: { topPx: number; bottomPx: number; note: string } | null;
};

const FEED_KEYWORDS = ["campus", "students", "activity", "daylight"] as const;

export const VISUAL_FORMATS: Record<VisualFormatId, VisualFormat> = {
  ig_feed_4x5: {
    id: "ig_feed_4x5",
    label: "Instagram 貼文 4:5",
    platform: "instagram",
    role: "feed",
    width: 1080,
    height: 1350,
    aspect: "4:5",
    unit: "px",
    dpi: null,
    print: null,
    compositionHint: "主標上三分之一，生活場景當主視覺，資訊列貼底。文字覆蓋不超過 28%。",
    sceneKeywords: [...FEED_KEYWORDS],
    textCoverageMaxPct: 28,
    cropSafe: { x: 0, y: 0, width: 1080, height: 1350 },
    uiSafe: null,
  },
  ig_story: {
    id: "ig_story",
    label: "Instagram 限時動態 9:16",
    platform: "instagram",
    role: "story",
    width: 1080,
    height: 1920,
    aspect: "9:16",
    unit: "px",
    dpi: null,
    print: null,
    compositionHint:
      "內容放在垂直 14%–78% 安全區；頂部避開頭像列，底部避開回覆列。主標短、字大。",
    sceneKeywords: [...FEED_KEYWORDS],
    textCoverageMaxPct: 22,
    cropSafe: { x: 0, y: 285, width: 1080, height: 1350 },
    uiSafe: {
      topPx: 250,
      bottomPx: 340,
      note: "INFERENCE：Instagram 限動 UI 慣例，不是 Meta 像素契約。",
    },
  },
  ig_reels_cover: {
    id: "ig_reels_cover",
    label: "Reels 封面 9:16",
    platform: "instagram",
    role: "reels_cover",
    width: 1080,
    height: 1920,
    aspect: "9:16",
    unit: "px",
    dpi: null,
    print: null,
    compositionHint:
      "主標與主體必須落在中央 4:5（y=285–1635）；上下裁切區不可放關鍵資訊。",
    sceneKeywords: [...FEED_KEYWORDS],
    textCoverageMaxPct: 22,
    cropSafe: { x: 0, y: 285, width: 1080, height: 1350 },
    uiSafe: {
      topPx: 250,
      bottomPx: 340,
      note: "INFERENCE：Reels 封面在動態牆會被裁成 4:5。",
    },
  },
  ig_carousel_4x5: {
    id: "ig_carousel_4x5",
    label: "Instagram 輪播 4:5",
    platform: "instagram",
    role: "carousel",
    width: 1080,
    height: 1350,
    aspect: "4:5",
    unit: "px",
    dpi: null,
    print: null,
    compositionHint:
      "第 1 頁只放鉤子與主視覺；中間頁說一件事；最後一頁才放時間地點／CTA／QR。",
    sceneKeywords: [...FEED_KEYWORDS],
    textCoverageMaxPct: 28,
    cropSafe: { x: 0, y: 0, width: 1080, height: 1350 },
    uiSafe: null,
  },
  poster_a4: {
    id: "poster_a4",
    label: "海報 A4",
    platform: "print",
    role: "poster",
    width: 2480,
    height: 3508,
    aspect: "210:297",
    unit: "px",
    dpi: 300,
    print: "A4",
    compositionHint:
      "300dpi。出血約 3mm，內安全區約 10mm。QR 邊長至少 20mm。資訊列貼底，主視覺留白。",
    sceneKeywords: [...FEED_KEYWORDS],
    textCoverageMaxPct: 32,
    cropSafe: { x: 118, y: 118, width: 2244, height: 3272 },
    uiSafe: null,
  },
  poster_a3: {
    id: "poster_a3",
    label: "海報 A3",
    platform: "print",
    role: "poster",
    width: 3508,
    height: 4961,
    aspect: "297:420",
    unit: "px",
    dpi: 300,
    print: "A3",
    compositionHint:
      "300dpi。出血約 3mm，內安全區約 10mm。QR 邊長至少 20mm。觀看距離較遠，主標更大。",
    sceneKeywords: [...FEED_KEYWORDS],
    textCoverageMaxPct: 30,
    cropSafe: { x: 118, y: 118, width: 3272, height: 4725 },
    uiSafe: null,
  },
};

const COPY_TO_VISUAL: Record<CopyFormat, VisualFormatId> = {
  post: "ig_feed_4x5",
  carousel: "ig_carousel_4x5",
  story: "ig_story",
  reel: "ig_reels_cover",
};

export function isVisualFormatId(value: string): value is VisualFormatId {
  return Object.prototype.hasOwnProperty.call(VISUAL_FORMATS, value);
}

export function visualFormat(id: VisualFormatId): VisualFormat {
  return VISUAL_FORMATS[id];
}

export function listVisualFormats(): VisualFormat[] {
  return VISUAL_FORMAT_IDS.map((id) => VISUAL_FORMATS[id]);
}

export function copyFormatToVisual(format: CopyFormat): VisualFormat {
  return VISUAL_FORMATS[COPY_TO_VISUAL[format]];
}
