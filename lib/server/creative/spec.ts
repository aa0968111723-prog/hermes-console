import { mapDataset } from "../canva";
import { canvaStatus } from "../canva";
import { WORKSPACE_OWNER } from "../security";
import type { RankableDirection } from "./ranking";

export interface CanvaCreativeSpec {
  headline: string;
  subheadline: string;
  body: string;
  cta: string;
  visualMood: string;
  compositionHint: string;
  colorMood: string;
  imageKeywords: string[];
  audienceNotes: string;
  templateDataset: Record<string, { type: "text"; text: string }>;
}

export function directionToSpec(
  direction: RankableDirection,
  audienceNotes: string,
): CanvaCreativeSpec {
  const headline = direction.title.slice(0, 40);
  const subheadline = (direction.coreIdea || direction.claim).slice(0, 80);
  return {
    headline,
    subheadline,
    body: direction.copy.slice(0, 200),
    cta: direction.cta,
    visualMood: direction.visual.slice(0, 120),
    compositionHint: "主標上三分之一，生活場景當主視覺，資訊列貼底。",
    colorMood: "校園白天、低對比、避免寺廟金紅。",
    imageKeywords: ["campus", "students", "tea", "daylight"],
    audienceNotes,
    templateDataset: {
      TITLE: { type: "text", text: headline },
      SUBTITLE: { type: "text", text: subheadline },
      CTA: { type: "text", text: direction.cta },
    },
  };
}

export function validateSpecForTemplate(
  spec: CanvaCreativeSpec,
  dataset: Record<string, { type?: string }>,
) {
  const canva = canvaStatus(WORKSPACE_OWNER);
  if (!canva.configured || canva.needsAuthorization)
    return {
      ok: false,
      blocked: "Needs Canva Authorization",
      mapping: { mapped: {}, missing: Object.keys(dataset) },
    };
  const mapping = mapDataset(dataset, spec.templateDataset);
  return {
    ok: mapping.missing.length === 0,
    blocked: mapping.missing.includes("TITLE")
      ? "缺 headline field，不能硬送 autofill。"
      : mapping.missing.length
        ? "欄位與範本不符。"
        : null,
    mapping,
  };
}

export function revisionFromAudience(copy: string) {
  const jargon = /靜定|禪修/.test(copy);
  return {
    copyRevision: jargon ? "主標改生活場景，術語移到副標。" : "保留主標，補時間地點。",
    ctaRevision: "用「來坐一下」代替「立即報名」。",
    visualRevision: "加入校園／淡水生活物件，避免香爐特寫當第一眼。",
    layoutSuggestion: "資訊列固定底部：時間、地點、社團名。",
    executableInCanva: false,
    editInstructions: "Canva Autofill 只能改已對應欄位；構圖需在 Canva 內手工調整。",
  };
}
