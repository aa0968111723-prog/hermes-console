import {
  ingestUrl,
  listInspiration,
  type InspirationItem,
} from "../inspiration";
import { wrapUntrusted, containsInjectionAttempt } from "../untrusted";
import { parseInspirationQuery, type InspirationQuery } from "./query";
import { canonicalUrl, dedupeInspiration } from "./dedupe";
import { PROVIDERS, providerHealth } from "./providers";
import { matchCaptionPatterns, tkuVisualLanguage, type VisualPattern } from "./visual-language";

export function analyzeReference(input: {
  caption?: string;
  platform: string;
  sourceUrl: string;
}) {
  const caption = input.caption || "";
  const injected = containsInjectionAttempt(caption);
  const matched = caption ? matchCaptionPatterns(caption) : [];
  const hookPattern = caption
    ? firstLineHook(caption)
    : "沒有 caption，無法判斷鉤子。";
  const ctaAnalysis = /手搖飲|來玩|晃晃|攤位/.test(caption)
    ? "低壓到場 CTA（玩／拿／晃晃）。"
    : /報名|表單|來參加|連結|swipe/i.test(caption)
      ? "文案含表單或行動呼籲跡象。"
      : "未見明確 CTA。";
  const audiencePattern = /新鮮人|新生|社博/.test(caption)
    ? "對準大一／社博逛攤。"
    : /淡水|天氣|雨/.test(caption)
      ? "對準淡水生活痛點。"
      : /宗教|禪是/.test(caption)
        ? "對準怕宗教的觀望者。"
        : "受眾不明。";
  const layoutHint = /時間：|地點：|19:00/.test(caption)
    ? "文案含時間地點，封面應避免再塞同一段字。"
    : "未見時間地點區塊。";
  return {
    visualAnalysis: null,
    imageRead: false,
    method: "caption_rules",
    copyAnalysis: caption
      ? wrapUntrusted("caption", caption).slice(0, 400)
      : "沒有 caption。",
    hookPattern,
    ctaAnalysis,
    audiencePattern,
    layoutHint,
    matchedPatterns: matched,
    whyRelevant: matched.length
      ? "尚未讀取圖片。文案對應既有禪學社模式：" + matched.join("、") + "。"
      : "尚未讀取圖片，無法評估構圖、配色與適用性。",
    risks: injected
      ? "caption 含指令式文字，已當不可信資料。"
      : "參考素材不代表可用於正式發佈。",
    rightsNote: "可見性不代表權利已清除。",
    injectionAttempt: injected,
    executable: false,
  };
}

function firstLineHook(caption: string) {
  const line = caption.split(/\n/)[0]?.replace(/\s+/g, " ").trim() || "";
  return line ? "首行鉤子：" + line.slice(0, 40) : "首行空白。";
}

type ClusterBucket = {
  kind: InspirationClusterKind;
  title: string;
  summary: string;
  itemIds: string[];
};

function clusterKey(kind: InspirationClusterKind, title: string) {
  return kind + ":" + title.slice(0, 80);
}

function scoreLanguagePattern(
  query: InspirationQuery,
  pattern: { title: string; summary: string; cues: string[] },
  captions: string[],
) {
  const haystack = [query.raw, ...captions].join("\n");
  let score = pattern.cues.filter((cue) => cue && haystack.includes(cue)).length;
  const blob = pattern.title + pattern.summary + pattern.cues.join("");
  if (/茶會|茶/.test(query.raw) && /茶|休息|靜定|靜下來/.test(blob)) score += 2;
  if (/新生|招新|社博|網宣/.test(query.raw) && /社博|新生|攤|晃晃|封面/.test(blob))
    score += 2;
  if (query.target) score += 1;
  return score;
}

export function clusterInspiration(input: {
  query: InspirationQuery;
  items: InspirationItem[];
}): { clusters: InspirationCluster[]; directions: InspirationDirection[] } {
  const buckets = new Map<string, ClusterBucket>();
  function add(
    kind: InspirationClusterKind,
    title: string,
    summary: string,
    itemId?: string,
  ) {
    const id = clusterKey(kind, title);
    const current = buckets.get(id) || {
      kind,
      title,
      summary,
      itemIds: [],
    };
    if (itemId && !current.itemIds.includes(itemId)) current.itemIds.push(itemId);
    buckets.set(id, current);
  }

  for (const item of input.items) {
    const analysis = analyzeReference({
      caption: item.captionExcerpt || undefined,
      platform: item.platform,
      sourceUrl: item.sourceUrl,
    });
    for (const pattern of analysis.matchedPatterns)
      add("hook", pattern, "文案對應既有模式，尚未讀圖。", item.id);
    if (analysis.audiencePattern !== "受眾不明")
      add(
        "audience",
        analysis.audiencePattern,
        "依 caption 規則判斷，未讀圖。",
        item.id,
      );
    if (analysis.ctaAnalysis !== "未見明確 CTA")
      add("cta", analysis.ctaAnalysis, "依 caption 規則判斷，未讀圖。", item.id);
    if (analysis.layoutHint !== "未見時間地點區塊。")
      add("layout", analysis.layoutHint, "依 caption 規則判斷，未讀圖。", item.id);
    add(
      "platform",
      item.platform,
      "來源平台分群，不是該平台全站搜尋。",
      item.id,
    );
  }

  const language = tkuVisualLanguage();
  const captions = input.items.map((item) => item.captionExcerpt || "");
  const ranked = [...language.keep]
    .map((pattern) => ({
      pattern,
      score: scoreLanguagePattern(input.query, pattern, captions),
    }))
    .sort((left, right) => right.score - left.score);
  for (const { pattern } of ranked.slice(0, 4)) {
    add(pattern.kind, pattern.title, pattern.summary);
    for (const item of input.items) {
      const caption = item.captionExcerpt || "";
      if (pattern.cues.some((cue) => cue && caption.includes(cue)))
        add(pattern.kind, pattern.title, pattern.summary, item.id);
    }
  }

  const clusters: InspirationCluster[] = [...buckets.values()]
    .sort((left, right) => right.itemIds.length - left.itemIds.length)
    .slice(0, 8)
    .map((bucket) => ({
      id: clusterKey(bucket.kind, bucket.title),
      kind: bucket.kind,
      title: bucket.title,
      summary: bucket.summary,
      itemIds: bucket.itemIds,
      provenance: bucket.itemIds.length ? "EVIDENCE" : "INSPIRATION",
      imageRead: false,
    }));

  const preferred = clusters.filter((cluster) => cluster.kind !== "platform");
  const source = (preferred.length ? preferred : clusters).slice(0, 3);
  const labels = ["A", "B", "C"] as const;
  let directions: InspirationDirection[] = source.map((cluster, index) => ({
    id: labels[index],
    title: cluster.title,
    summary: cluster.summary,
    clusterIds: [cluster.id],
    evidenceUrls: input.items
      .filter((item) => cluster.itemIds.includes(item.id))
      .map((item) => item.sourceUrl)
      .slice(0, 5),
    confidence: cluster.itemIds.length ? "medium" : "low",
    source: cluster.itemIds.length ? "saved_references" : "visual_language",
  }));
  if (!directions.length) {
    directions = language.keep.slice(0, 3).map((pattern, index) => ({
      id: labels[index],
      title: pattern.title,
      summary: pattern.summary,
      clusterIds: [],
      evidenceUrls: [],
      confidence: "low" as const,
      source: "visual_language" as const,
    }));
  }
  return { clusters, directions };
}

export function toInspirationPack(input: {
  prompt: string;
  projectId: string;
  items: InspirationItem[];
  query?: InspirationQuery;
}): InspirationSearchPack {
  const query = input.query || parseInspirationQuery(input.prompt);
  const clustered = clusterInspiration({ query, items: input.items });
  return {
    kind: "inspiration_search",
    fullSiteSearch: false,
    instagramFullSite: false,
    pinterestFullSite: false,
    imageRead: false,
    query: {
      primary: query.primary,
      audience: query.audience,
      platform: query.platform,
    },
    itemCount: input.items.length,
    clusters: clustered.clusters,
    directions: clustered.directions,
    cards: input.items.slice(0, 12).map((item) => ({
      id: item.id,
      platform: item.platform,
      sourceUrl: item.sourceUrl,
      thumb: item.image && item.image.startsWith("/api/materials") ? item.image : null,
      account: item.account,
    })),
    notice: input.items.length
      ? "只分群已收藏來源與社團視覺語言；沒有搜尋整個 Instagram 或 Pinterest。"
      : "沒有已收藏來源。方向來自社團視覺語言，不是全站搜尋。可貼連結或再說一次需求。",
    providers: providerHealth().map((provider) => ({
      id: provider.id,
      state: provider.state,
    })),
  };
}

export function searchInspiration(input: {
  prompt: string;
  projectId: string;
}) {
  const query = parseInspirationQuery(input.prompt);
  const collected = PROVIDERS.flatMap((provider) =>
    provider.search(query, input.projectId),
  );
  const items = dedupeInspiration(
    collected.map((item) => ({
      ...item,
      title: item.account,
      caption: item.captionExcerpt,
    })),
  );
  const pack = toInspirationPack({
    prompt: input.prompt,
    projectId: input.projectId,
    items,
    query,
  });
  return {
    ...pack,
    query,
    items,
    providers: providerHealth(),
    fullSiteSearch: false as const,
    notice: pack.notice,
  };
}

export function resolveInspirationUrl(input: {
  url: string;
  projectId: string;
  caption?: string;
  account?: string;
}): InspirationItem {
  const item = ingestUrl({
    url: input.url,
    projectId: input.projectId,
    caption: input.caption,
    account: input.account,
  });
  const analysis = analyzeReference({
    caption: input.caption,
    platform: item.platform,
    sourceUrl: item.sourceUrl,
  });
  return {
    ...item,
    analysis: analysis.copyAnalysis,
    borrow: analysis.matchedPatterns,
    fit: analysis.whyRelevant,
    risk: analysis.risks,
    sourceUrl: canonicalUrl(item.sourceUrl),
  };
}

export function boardFor(projectId: string, prompt = "靈感板") {
  const items = dedupeInspiration(
    listInspiration(projectId).map((item) => ({
      ...item,
      title: item.account,
      caption: item.captionExcerpt,
    })),
  );
  return {
    items,
    providers: providerHealth(),
    pack: toInspirationPack({ prompt, projectId, items }),
  };
}

function compactPattern(pattern: VisualPattern) {
  return {
    id: pattern.id,
    kind: pattern.kind,
    suitability: pattern.suitability,
    title: pattern.title,
    summary: pattern.summary,
  };
}

export function inspirationBriefForAgent(input: {
  prompt: string;
  projectId: string;
}) {
  const found = searchInspiration(input);
  const language = tkuVisualLanguage();
  return {
    query: found.query.primary,
    fullSiteSearch: false,
    instagramConnected: false,
    notice:
      "已保存參考與社團視覺模式快照。不是 Instagram／Pinterest 全站搜尋，也不是已連線官方 API。",
    providers: found.providers.map((item) => ({
      id: item.id,
      state: item.state,
      detail: item.detail,
    })),
    references: found.items.slice(0, 8).map((item) => ({
      platform: item.platform,
      sourceUrl: item.sourceUrl,
      account: item.account,
      captionExcerpt: (item.captionExcerpt || "").slice(0, 120),
      analysis: item.analysis.slice(0, 160),
      sourceType: item.sourceType,
    })),
    visualLanguage: {
      account: language.account,
      imageReadCount: language.imageReadCount,
      biggestProblem: language.biggestProblem,
      improvements: language.improvements,
      keep: language.keep.slice(0, 6).map(compactPattern),
      avoid: language.avoid.slice(0, 4).map(compactPattern),
      visualDo: language.visualAgent.do,
      visualDont: language.visualAgent.dont,
    },
  };
}
