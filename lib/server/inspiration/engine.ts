import {
  ingestUrl,
  listInspiration,
  type InspirationItem,
} from "../inspiration";
import { wrapUntrusted, containsInjectionAttempt } from "../untrusted";
import { parseInspirationQuery } from "./query";
import { canonicalUrl, dedupeInspiration } from "./dedupe";
import { PROVIDERS, providerHealth } from "./providers";

export function analyzeReference(input: {
  caption?: string;
  platform: string;
  sourceUrl: string;
}) {
  const caption = input.caption || "";
  const injected = containsInjectionAttempt(caption);
  return {
    visualAnalysis: "僅依使用者提供的連結／圖檔描述層級與風格，未抓取原站。",
    copyAnalysis: caption
      ? wrapUntrusted("caption", caption).slice(0, 400)
      : "沒有 caption。",
    ctaAnalysis: /報名|來參加|連結|swipe/i.test(caption)
      ? "文案含行動呼籲跡象。"
      : "未見明確 CTA。",
    whyRelevant: "可借鑑結構與層級，不可原樣複製。",
    risks: injected
      ? "caption 含指令式文字，已當不可信資料。"
      : "參考素材不代表可用於正式發佈。",
    rightsNote: "可見性不代表權利已清除。",
    injectionAttempt: injected,
    executable: false,
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
  return {
    query,
    items,
    providers: providerHealth(),
    fullSiteSearch: false,
    notice:
      "統一 Inspiration Engine：未授權時只合併已保存參考與可解析 URL，不假裝 Instagram／Pinterest 全站搜尋。",
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
    borrow: ["層級", "配色節奏", "CTA 位置"].slice(0, analysis.injectionAttempt ? 0 : 3),
    fit: analysis.whyRelevant,
    risk: analysis.risks,
    sourceUrl: canonicalUrl(item.sourceUrl),
  };
}

export function boardFor(projectId: string) {
  return {
    items: dedupeInspiration(
      listInspiration(projectId).map((item) => ({
        ...item,
        title: item.account,
        caption: item.captionExcerpt,
      })),
    ),
    providers: providerHealth(),
  };
}
