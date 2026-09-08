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

function hanBigrams(text: string) {
  const chars = [...text.matchAll(/\p{Script=Han}/gu)].map((match) => match[0]);
  const grams: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) grams.push(chars[i] + chars[i + 1]);
  return grams;
}

export function relevanceTerms(text: string) {
  const lower = text.toLowerCase();
  const latin = lower
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1 && !/^\p{Script=Han}+$/u.test(term));
  return [...latin, ...hanBigrams(lower)];
}

export function relevanceTo(text: string, query: string) {
  const hay = text.toLowerCase();
  const terms = relevanceTerms(query);
  if (!terms.length) return 0.2;
  const unique = [...new Set(terms)];
  const hits = unique.filter((term) => hay.includes(term)).length;
  return Math.min(1, 0.2 + hits / Math.min(8, unique.length));
}
