import {
  ingestUrl,
  listInspiration,
  type InspirationItem,
} from "../inspiration";
import { wrapUntrusted, containsInjectionAttempt } from "../untrusted";
import { parseInspirationQuery } from "./query";
import { canonicalUrl, dedupeInspiration } from "./dedupe";
import { PROVIDERS, providerHealth } from "./providers";
import { matchCaptionPatterns } from "./visual-language";

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
    borrow: analysis.matchedPatterns,
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
