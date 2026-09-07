import type { ContextItem } from "./provenance";

export function rankScore(item: ContextItem) {
  return (
    item.relevance * 0.4 +
    item.recency * 0.25 +
    item.importance * 0.2 +
    item.confidence * 0.15
  );
}

export function rankContext(items: ContextItem[]) {
  return [...items].sort((a, b) => rankScore(b) - rankScore(a));
}

export function relevanceTo(text: string, query: string) {
  const hay = text.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1);
  if (!terms.length) return 0.2;
  const hits = terms.filter((term) => hay.includes(term)).length;
  return Math.min(1, 0.2 + hits / Math.min(8, terms.length));
}
