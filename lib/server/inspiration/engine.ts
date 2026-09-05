/**
 * Universal Inspiration Engine — truthful sources only.
 * Console palettes are fixtures. URL ingest classifies HTTPS links; it does not scrape.
 */
import {
  ingestUrl,
  listInspiration,
  type InspirationItem,
} from "../inspiration";
import { wrapUntrusted, containsInjectionAttempt } from "../untrusted";
import { parseInspirationQuery, type InspirationQuery } from "./query";
import { canonicalUrl, dedupeInspiration } from "./dedupe";
import { PROVIDERS, providerHealth, type ProviderHealth } from "./providers";

export type CampusInspirationDomain = "tamkang" | "ntu" | "general";

export interface CuratedInspirationItem {
  id: string;
  type: "web_trend" | "social_aesthetic" | "canva_template" | "color_scheme";
  title: string;
  description: string;
  visualMood: string;
  colorPalette: { name: string; hex: string }[];
  typographySuggestion: string;
  tags: string[];
  rightsNote: string;
  sourceUrl?: string;
  sourceKind: "console_fixture";
  domain: CampusInspirationDomain;
  liveFetch: false;
  fetchedAt: null;
  fullSiteSearch: false;
}

const FIXTURE_RIGHTS =
  "控制台內建風格參考（console_fixture），不是即時網路趨勢或平台搜尋結果。可見性不代表權利已清除。";

export const CURATED_INSPIRATIONS: CuratedInspirationItem[] = [
  {
    id: "insp_tamsui_sunset",
    type: "social_aesthetic",
    title: "淡水暮色・茶席微光風格",
    description: "擷取淡水河口暮色、老茶館陶碗與宮燈教室紅磚屋簷的溫潤調性。強調低彩度暖調、柔和散景與留白呼吸感，消除視覺壓迫感。",
    visualMood: "靜謐・沉澱・溫暖・無壓",
    colorPalette: [
      { name: "靜謐深苔綠", hex: "#2E4036" },
      { name: "燕麥暖白", hex: "#F3EFE6" },
      { name: "陶土茶韻褐", hex: "#C29B7F" },
      { name: "暮光杏仁金", hex: "#E2C391" }
    ],
    typographySuggestion: "大標題使用思源宋體（Noto Serif TC）營造人文底蘊，內文搭配清爽無襯線體（Noto Sans TC）。",
    tags: ["淡水暮色", "陶茶質地", "低飽和度", "人文文青"],
    rightsNote: FIXTURE_RIGHTS,
    sourceKind: "console_fixture",
    domain: "tamkang",
    liveFetch: false,
    fetchedAt: null,
    fullSiteSearch: false
  },
  {
    id: "insp_kenan_recharge",
    type: "web_trend",
    title: "克難坡登頂心靈充電站",
    description: "以淡江學生每天爬克難坡 132 階的日常為切入點，將『身體疲累』轉化為『大腦重開機』的共鳴情境。排版採現代雜誌感（Editorial Layout），圖文分割俐落。",
    visualMood: "元氣・幽默共鳴・清爽・通透",
    colorPalette: [
      { name: "竹林晨露綠", hex: "#4A6B56" },
      { name: "清爽米紙白", hex: "#FAF8F5" },
      { name: "晨曦活力橙", hex: "#E28743" },
      { name: "冷杉灰綠", hex: "#8A9F90" }
    ],
    typographySuggestion: "採用現代黑體搭配重點手寫手寫字體點綴（例如『累了嗎？先喝杯茶』）。",
    tags: ["校園日常", "克難坡梗", "活力重開機", "雜誌排版"],
    rightsNote: FIXTURE_RIGHTS,
    sourceKind: "console_fixture",
    domain: "tamkang",
    liveFetch: false,
    fetchedAt: null,
    fullSiteSearch: false
  },
  {
    id: "insp_fuyuan_zen",
    type: "canva_template",
    title: "福園微瀾・極簡禪意茶宴",
    description: "以黑天鵝水波紋、簡潔幾何圓圈代表三色光手作印章。版面留白超過 50%，給眼球充分放鬆餘裕，符合禪學社『清空雜訊』的訴求。",
    visualMood: "極簡・清冷空靈・高級感",
    colorPalette: [
      { name: "深潭黛青", hex: "#1F2F2D" },
      { name: "水霧淺灰青", hex: "#D4DFD9" },
      { name: "素雅原麻色", hex: "#EAE6DF" },
      { name: "硃砂微印紅", hex: "#A94442" }
    ],
    typographySuggestion: "細明宋體搭配寬鬆字距（Letter-spacing: 0.15em），呼吸感極強。",
    tags: ["極簡主義", "水波倒影", "高級留白", "Canva推薦"],
    rightsNote: FIXTURE_RIGHTS,
    sourceKind: "console_fixture",
    domain: "tamkang",
    liveFetch: false,
    fetchedAt: null,
    fullSiteSearch: false
  },
  {
    id: "insp_ntu_yelin_minimal",
    type: "social_aesthetic",
    title: "臺大椰林・醉月湖畔極簡野餐微光風格",
    description: "結合臺大椰林大道開闊感與醉月湖畔午後草地野餐氛圍。強調通透自然光影、微風草皮綠與米白留白，營造無壓自在社交場景。",
    visualMood: "通透・湖畔微風・自在・無壓",
    colorPalette: [
      { name: "椰林深青綠", hex: "#2A4736" },
      { name: "醉月湖水碧", hex: "#5C8276" },
      { name: "溫潤米紙白", hex: "#F6F4ED" },
      { name: "晨曦活力金", hex: "#D9A84E" }
    ],
    typographySuggestion: "大標題使用思源宋體 Bold 44pt，副標題搭配思源黑體 Regular 20pt，視覺層次分明。",
    tags: ["臺大", "椰林大道", "醉月湖", "草地野餐", "自然光影"],
    rightsNote: FIXTURE_RIGHTS,
    sourceKind: "console_fixture",
    domain: "ntu",
    liveFetch: false,
    fetchedAt: null,
    fullSiteSearch: false
  },
  {
    id: "insp_campus_editorial_zen",
    type: "web_trend",
    title: "當代青年學誌・低飽和留白社團風格",
    description: "針對大專院校青年族群打造之當代文藝排版。以深茶綠、溫暖燕麥白與陶土褐為核心色盤，50% 以上留白呼吸感，消除視覺疲勞。",
    visualMood: "極簡・文青・放鬆・呼吸感",
    colorPalette: [
      { name: "冷杉灰綠", hex: "#4A6357" },
      { name: "溫暖燕麥白", hex: "#EDE8DF" },
      { name: "陶土茶韻褐", hex: "#B87A4B" },
      { name: "暮光杏仁金", hex: "#E2C391" }
    ],
    typographySuggestion: "以思源宋體做為視覺焦點，搭配手作圓形三色光 36px 邊角落款。",
    tags: ["校園生活", "青年學誌", "低飽和度", "極簡排版", "茶席放鬆"],
    rightsNote: FIXTURE_RIGHTS,
    sourceKind: "console_fixture",
    domain: "general",
    liveFetch: false,
    fetchedAt: null,
    fullSiteSearch: false
  }
];

const GENERIC_PALETTE = CURATED_INSPIRATIONS.find((item) => item.domain === "general")!.colorPalette;

export interface ParsedInspirationLink {
  platform: "instagram" | "pinterest" | "canva" | "web";
  title: string;
  insights: string[];
  extractedPalette: { name: string; hex: string }[];
  rightsNotice: string;
  fetched: false;
  liveContent: null;
  sourceKind: "url_classified";
  extractionMode: "heuristic_not_fetched";
  classifiedUrl: string;
}

function heuristicInsights(platform: ParsedInspirationLink["platform"]): string[] {
  const prefix = "此為平台慣例啟發式，並未抓取該網址內容。";
  if (platform === "instagram") {
    return [
      prefix,
      "IG 直式 4:5 (1080x1350) 與限動 9:16 為大學生常用比例（啟發式，非 Meta 實測）",
      "封面首圖避免過多小字，主視覺焦點需在中央 1:1 安全方格內",
      "公開社群引用符合合理使用原則，僅作為風格與版面構圖參考"
    ];
  }
  if (platform === "pinterest") {
    return [
      prefix,
      "重視自然光影與材質細節（如粗陶茶碗、自然竹木紋理）",
      "色調多採用低飽和大地色系（Earth Tone）"
    ];
  }
  if (platform === "canva") {
    return [
      prefix,
      "分層架構常見：背景層 -> 圖片遮罩 -> 標題組 -> 說明文字 -> CTA 按鈕",
      "文字框常設自適應邊距，替換文案時較不易破版"
    ];
  }
  return [
    prefix,
    "現代文青青年網站趨勢啟發式：大字標題、精準留白、柔和過渡效果"
  ];
}

/**
 * Classify a user-supplied inspiration URL. Does not fetch or scrape the remote page.
 */
export function parseInspirationLink(rawUrl: string): ParsedInspirationLink {
  const classifiedUrl = String(rawUrl || "").trim();
  const url = classifiedUrl.toLowerCase();
  const platform: ParsedInspirationLink["platform"] = url.includes("instagram.com")
    ? "instagram"
    : url.includes("pinterest.com")
      ? "pinterest"
      : url.includes("canva.com")
        ? "canva"
        : "web";
  const titles = {
    instagram: "Instagram 連結已分類（未抓取）",
    pinterest: "Pinterest 連結已分類（未抓取）",
    canva: "Canva 連結已分類（未抓取）",
    web: "網頁連結已分類（未抓取）"
  } as const;
  const rights = {
    instagram: "公開社群引用符合合理使用原則，僅作為風格與版面構圖參考；本機未下載原圖。",
    pinterest: "Pinterest 連結僅分類，不得直接轉載未授權攝影原作；符合合理使用之構圖參考。",
    canva: "可使用 Canva 自由授權元件；本分類未呼叫 Canva API 也未匯入模板。符合合理使用。",
    web: "遵守合理使用與原創改作規範；未抓取該網頁本文或圖片。"
  } as const;
  return {
    platform,
    title: titles[platform],
    insights: heuristicInsights(platform),
    extractedPalette: GENERIC_PALETTE,
    rightsNotice: rights[platform],
    fetched: false,
    liveContent: null,
    sourceKind: "url_classified",
    extractionMode: "heuristic_not_fetched",
    classifiedUrl
  };
}

export function searchInspirations(
  keyword?: string,
  domain?: CampusInspirationDomain,
): CuratedInspirationItem[] {
  const kw = (keyword || "").trim().toLowerCase();
  const scoped = CURATED_INSPIRATIONS.filter((item) => !domain || item.domain === domain);
  if (!kw) return scoped;
  const matched = scoped.filter((item) =>
    item.title.toLowerCase().includes(kw) ||
    item.description.toLowerCase().includes(kw) ||
    item.tags.some((tag) => tag.toLowerCase().includes(kw))
  );
  return domain ? (matched.length > 0 ? matched : scoped) : matched;
}

export function domainFromQuery(
  query: Pick<InspirationQuery, "target" | "raw">,
): CampusInspirationDomain | "unspecified" {
  if (query.target === "Tamkang freshman" || /淡江/.test(query.raw)) return "tamkang";
  if (query.target === "NTU freshman" || /台大|臺大/.test(query.raw)) return "ntu";
  if (query.target === "university freshman") return "general";
  return "unspecified";
}

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
    fetched: false as const,
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
  const domain = domainFromQuery(query);
  const fixtures = searchInspirations(
    undefined,
    domain === "unspecified" ? undefined : domain,
  );
  return {
    query,
    items,
    fixtures,
    providers: providerHealth(),
    fullSiteSearch: false as const,
    liveFetch: false as const,
    fetchedAt: null,
    notice:
      "統一 Inspiration Engine：未授權時只合併已保存參考、可解析 URL 與控制台風格參考庫，不假裝 Instagram／Pinterest 全站搜尋。",
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
    sourceType: "user_url",
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
    fullSiteSearch: false as const,
    liveFetch: false as const,
  };
}

export interface InspirationPipelineResult {
  query: InspirationQuery;
  domain: CampusInspirationDomain | "unspecified";
  fixtures: CuratedInspirationItem[];
  savedItems: InspirationItem[];
  urlResolution: ParsedInspirationLink | null;
  providers: ProviderHealth[];
  fullSiteSearch: false;
  liveFetch: false;
  fetchedAt: null;
  notice: string;
}

export function runInspirationPipeline(input: {
  prompt: string;
  projectId?: string;
  domain?: CampusInspirationDomain;
  url?: string;
}): InspirationPipelineResult {
  const query = parseInspirationQuery(input.prompt);
  const domain = input.domain ?? domainFromQuery(query);
  const scopedDomain = domain === "unspecified" ? undefined : domain;
  const saved = searchInspiration({
    prompt: input.prompt,
    projectId: input.projectId || "personal",
  });
  return {
    query,
    domain,
    fixtures: searchInspirations(undefined, scopedDomain),
    savedItems: saved.items,
    urlResolution: input.url ? parseInspirationLink(input.url) : null,
    providers: saved.providers,
    fullSiteSearch: false,
    liveFetch: false,
    fetchedAt: null,
    notice:
      "Truthful inspiration pipeline：控制台風格庫為 console_fixture；URL 只分類不抓取；Instagram／Pinterest 全站搜尋未授權且未執行。",
  };
}
