export type InspirationClusterKind =
  | "hook"
  | "cta"
  | "audience"
  | "layout"
  | "platform"
  | "design";

export type InspirationCluster = {
  id: string;
  kind: InspirationClusterKind;
  title: string;
  summary: string;
  itemIds: string[];
  provenance: "EVIDENCE" | "INSPIRATION";
  imageRead: false;
};

export type InspirationDirection = {
  id: "A" | "B" | "C";
  title: string;
  summary: string;
  clusterIds: string[];
  evidenceUrls: string[];
  confidence: "low" | "medium";
  source: "saved_references" | "visual_language";
};

export type InspirationCard = {
  id: string;
  platform: string;
  sourceUrl: string;
  thumb: string | null;
  account: string | null;
};

export type InspirationSearchPack = {
  kind: "inspiration_search";
  fullSiteSearch: false;
  instagramFullSite: false;
  pinterestFullSite: false;
  imageRead: false;
  query: {
    primary: string;
    audience: string;
    platform: string;
  };
  itemCount: number;
  clusters: InspirationCluster[];
  directions: InspirationDirection[];
  cards: InspirationCard[];
  notice: string;
  providers: Array<{ id: string; state: string }>;
};

export function isInspirationSearchPack(
  value: unknown,
): value is InspirationSearchPack {
  if (!value || typeof value !== "object") return false;
  const pack = value as Record<string, unknown>;
  return (
    pack.kind === "inspiration_search" &&
    pack.fullSiteSearch === false &&
    pack.instagramFullSite === false &&
    pack.pinterestFullSite === false &&
    pack.imageRead === false &&
    Array.isArray(pack.clusters) &&
    Array.isArray(pack.directions) &&
    Array.isArray(pack.cards) &&
    typeof pack.notice === "string" &&
    typeof pack.itemCount === "number"
  );
}
