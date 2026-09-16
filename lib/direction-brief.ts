import type { CopyReview } from "@/lib/server/copywriting/types";

export type DirectionBriefFormat = {
  id: string;
  label: string;
  aspect: string;
  width: number;
  height: number;
  compositionHint: string;
};

export type DirectionBriefPack = {
  kind: "direction_brief";
  selected: "A" | "B" | "C";
  title: string;
  summary: string;
  hermesGenerated: false;
  rendered: false;
  generatedImage: false;
  publish: false;
  formats: DirectionBriefFormat[];
  copy: { a: string; b: string; c: string };
  review: CopyReview;
  notice: string;
  activityId?: string | null;
  copyId?: string | null;
  revision?: number | null;
};

export function isDirectionBriefPack(
  value: unknown,
): value is DirectionBriefPack {
  if (!value || typeof value !== "object") return false;
  const pack = value as Record<string, unknown>;
  return (
    pack.kind === "direction_brief" &&
    pack.hermesGenerated === false &&
    pack.rendered === false &&
    pack.generatedImage === false &&
    pack.publish === false &&
    (pack.selected === "A" || pack.selected === "B" || pack.selected === "C") &&
    typeof pack.title === "string" &&
    typeof pack.summary === "string" &&
    Array.isArray(pack.formats) &&
    typeof pack.copy === "object" &&
    pack.copy !== null &&
    typeof pack.notice === "string"
  );
}
