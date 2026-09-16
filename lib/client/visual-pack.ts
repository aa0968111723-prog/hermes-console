export type VisualPackConcept = {
  id: "A" | "B" | "C";
  name: string;
  creativeDirection: string;
  background: string;
  visualHierarchy: string[];
  generatedImage: false;
  rendered: false;
  qrPlacement?: { include: boolean; reason: string };
  ctaPlacement?: { copy: string | null };
  layout?: {
    formatId: string;
    textCoverageMaxPct: number;
    zones?: Record<string, { xPct: number; yPct: number; wPct: number; hPct: number }>;
  };
};

export type VisualPackView = {
  title: string;
  notice: string;
  generatedImage: false;
  rendered: false;
  publish: false;
  format: {
    id: string;
    label: string;
    width: number;
    height: number;
    aspect: string;
  };
  unknownFields: string[];
  overlayText?: Record<string, string | null>;
  concepts: VisualPackConcept[];
};

export function isVisualConceptPack(value: unknown): value is VisualPackView {
  if (!value || typeof value !== "object") return false;
  const pack = value as Record<string, unknown>;
  if (pack.generatedImage !== false || pack.rendered !== false || pack.publish !== false)
    return false;
  const format = pack.format as Record<string, unknown> | undefined;
  if (
    !format ||
    typeof format.label !== "string" ||
    typeof format.width !== "number" ||
    typeof format.height !== "number"
  )
    return false;
  if (!Array.isArray(pack.concepts) || pack.concepts.length !== 3) return false;
  const ids = pack.concepts.map((item) =>
    item && typeof item === "object"
      ? (item as { id?: unknown }).id
      : null,
  );
  return ids[0] === "A" && ids[1] === "B" && ids[2] === "C";
}

export function studentFormatLabel(label: string) {
  if (/海報 A4/.test(label)) return "海報 A4";
  if (/海報 A3/.test(label)) return "海報 A3";
  if (/限時動態|限動/.test(label)) return "限時動態";
  if (/Reels/.test(label)) return "短影音封面";
  if (/輪播/.test(label)) return "輪播";
  if (/貼文/.test(label)) return "貼文";
  return label.replace(/Instagram\s*/g, "").replace(/\s+\d+:\d+$/, "").trim() || label;
}

export function studentUnknownNotice(fields: string[]) {
  if (!fields.length) return "";
  return "未提供：" + fields.join("、") + "，畫面上留空。";
}

export function parseVisualConceptPack(text: string): VisualPackView | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return isVisualConceptPack(value) ? value : null;
  } catch {
    return null;
  }
}
