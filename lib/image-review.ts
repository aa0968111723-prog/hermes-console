import { isTwinPanel } from "./server/audience/personas";
import type { TwinPanel } from "./server/audience/types";

export type ImageReviewCheck = {
  id: "pixel" | "hierarchy" | "type" | "audience";
  label: string;
  status: "unread" | "simulated";
  note: string;
};

export type ImageReviewPack = {
  kind: "image_review";
  pixelRead: false;
  hermesGenerated: false;
  simulation: true;
  materialIds: string[];
  checklist: ImageReviewCheck[];
  suggestions: string[];
  twinPanel: TwinPanel;
  notice: string;
};

export function twinPanelFromResults(results: unknown[]) {
  for (const result of results) {
    if (isTwinPanel(result)) return result;
    if (isImageReviewPack(result)) return result.twinPanel;
  }
  return undefined;
}

export function isImageReviewPack(value: unknown): value is ImageReviewPack {
  if (!value || typeof value !== "object") return false;
  const pack = value as Record<string, unknown>;
  return (
    pack.kind === "image_review" &&
    pack.pixelRead === false &&
    pack.hermesGenerated === false &&
    pack.simulation === true &&
    Array.isArray(pack.materialIds) &&
    Array.isArray(pack.checklist) &&
    Array.isArray(pack.suggestions) &&
    isTwinPanel(pack.twinPanel)
  );
}

export function workspaceImageReview(input: {
  materialIds: string[];
  twinPanel: TwinPanel;
}): ImageReviewPack {
  return {
    kind: "image_review",
    pixelRead: false,
    hermesGenerated: false,
    simulation: true,
    materialIds: input.materialIds,
    checklist: [
      {
        id: "pixel",
        label: "讀取畫面",
        status: "unread",
        note: "沒有讀取像素。",
      },
      {
        id: "hierarchy",
        label: "視覺層級",
        status: "unread",
        note: "沒看圖，不能評構圖。",
      },
      {
        id: "type",
        label: "字級與對比",
        status: "unread",
        note: "沒看圖，不能評字級。",
      },
      {
        id: "audience",
        label: "客群模擬",
        status: "simulated",
        note: "依檔名與提問文字，不是看圖。",
      },
    ],
    suggestions: [
      "先把活動在做什麼寫清楚，不要只靠畫面口號。",
      "時間地點還沒定就標未確認，不要捏造教室。",
      "要改構圖、字級、對比，需要 Hermes 讀圖後才能給具體建議。",
    ],
    twinPanel: input.twinPanel,
    notice:
      "這是工作區畫面審查草稿。沒有讀取像素，也不是 Hermes 看圖。客群反應是模擬，不是民調。",
  };
}
