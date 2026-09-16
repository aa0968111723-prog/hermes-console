export type InspirationPatternView = {
  id: string;
  kind: string;
  suitability: "keep" | "adapt" | "avoid";
  title: string;
  summary: string;
};

export type InspirationBriefView = {
  fullSiteSearch: false;
  instagramConnected: false;
  notice: string;
  references?: Array<{
    platform?: string;
    sourceUrl?: string;
    account?: string;
  }>;
  visualLanguage?: {
    biggestProblem?: string;
    keep?: InspirationPatternView[];
    avoid?: InspirationPatternView[];
  };
};

export function isInspirationBrief(value: unknown): value is InspirationBriefView {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.fullSiteSearch !== false) return false;
  if (item.instagramConnected !== false) return false;
  if (typeof item.notice !== "string" || !item.notice.trim()) return false;
  const language = item.visualLanguage;
  if (!language || typeof language !== "object") return false;
  const keep = (language as { keep?: unknown }).keep;
  return Array.isArray(keep);
}

export function inspirationDirectionPrompt(title: string) {
  return (
    "請用「" +
    title.slice(0, 40) +
    "」這個方向繼續，沿用同一視覺模式，不要另起無關作品。"
  );
}
