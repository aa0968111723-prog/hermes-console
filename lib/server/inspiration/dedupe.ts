export function canonicalUrl(raw: string) {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|igsh|igshid|fbclid)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    if (url.pathname.endsWith("/") && url.pathname.length > 1)
      url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return raw.trim();
  }
}

export function tokenSet(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
}

export function jaccard(a: string, b: string) {
  const left = tokenSet(a),
    right = tokenSet(b);
  if (!left.size && !right.size) return 1;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap++;
  return overlap / new Set([...left, ...right]).size;
}

export function dedupeInspiration<
  T extends {
    sourceUrl: string;
    title?: string | null;
    caption?: string | null;
  },
>(items: T[]): T[] {
  const kept: T[] = [];
  const urls = new Set<string>();
  for (const item of items) {
    const key = canonicalUrl(item.sourceUrl);
    if (urls.has(key)) continue;
    // Different URLs may show different images even when captions are empty or identical.
    urls.add(key);
    kept.push(item);
  }
  return kept;
}
