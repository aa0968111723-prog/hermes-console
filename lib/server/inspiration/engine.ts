/**
 * 萬象靈感引擎 (Universal Inspiration Engine)
 * 整合網路調研趨勢、社群視覺風格 (IG / Pinterest / Canva 範本) 與校園在地素材
 */

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
}

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
    rightsNote: "原創設計風格參考・無第三方版權爭議"
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
    rightsNote: "淡江校園生活文化共構・CC0 概念"
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
    rightsNote: "相容於 Canva 商業免費模板結構授權"
  }
];

/**
 * 解析使用者輸入之靈感連結 (IG, Pinterest, Canva 等)
 */
export function parseInspirationLink(rawUrl: string): {
  platform: "instagram" | "pinterest" | "canva" | "web";
  title: string;
  insights: string[];
  extractedPalette: { name: string; hex: string }[];
  rightsNotice: string;
} {
  const url = String(rawUrl || "").trim().toLowerCase();

  if (url.includes("instagram.com")) {
    return {
      platform: "instagram",
      title: "Instagram 視覺靈感擷取",
      insights: [
        "IG 直式 4:5 (1080x1350) 與限動 9:16 為大學生最高觸及比例",
        "封面首圖避免過多小字，主視覺焦點需在中央 1:1 安全方格內",
        "文案採用斷行排版與留言互動引導 (Call-to-Action)"
      ],
      extractedPalette: [
        { name: "社群暖晨白", hex: "#FAF7F2" },
        { name: "質感墨綠", hex: "#263D31" },
        { name: "焦糖蜜茶", hex: "#B87A4B" }
      ],
      rightsNotice: "公開社群引用符合合理使用原則，僅作為風格與版面構圖參考，圖片需自行拍攝或使用開源商用圖庫"
    };
  }

  if (url.includes("pinterest.com")) {
    return {
      platform: "pinterest",
      title: "Pinterest Moodboard 氛圍擷取",
      insights: [
        "重視自然光影與材質細節（如粗陶茶碗、自然竹木紋理、水珠折射）",
        "色調多採用低飽和大地色系（Earth Tone），呈現溫厚不刺眼的心靈感受"
      ],
      extractedPalette: [
        { name: "原木陶土", hex: "#8C6D58" },
        { name: "素雅棉麻", hex: "#E8E2D5" },
        { name: "若竹嫩青", hex: "#94A89A" }
      ],
      rightsNotice: "Pinterest 收集之情緒板屬靈感構思，不得直接轉載未授權攝影原作"
    };
  }

  if (url.includes("canva.com")) {
    return {
      platform: "canva",
      title: "Canva 模板結構解析",
      insights: [
        "分層架構完整：背景層 -> 圖片遮罩 -> 標題組 -> 說明文字 -> CTA 按鈕",
        "文字框均設有自適應邊距，替換文案時版面不致破版"
      ],
      extractedPalette: [
        { name: "極簡主底色", hex: "#F5F3EF" },
        { name: "重點深茶綠", hex: "#1C3328" },
        { name: "亮眼琥珀金", hex: "#D4A359" }
      ],
      rightsNotice: "可直接使用 Canva 自由授權元件進行商業宣傳與社團推播"
    };
  }

  return {
    platform: "web",
    title: "網頁靈感資料擷取",
    insights: ["現代文青青年網站趨勢：大字標題、精準留白、柔和過渡效果"],
    extractedPalette: CURATED_INSPIRATIONS[0].colorPalette,
    rightsNotice: "遵守合理使用與原創改作規範"
  };
}

/**
 * 依關鍵字搜尋靈感庫
 */
export function searchInspirations(keyword?: string): CuratedInspirationItem[] {
  if (!keyword) return CURATED_INSPIRATIONS;
  const kw = keyword.toLowerCase();
  return CURATED_INSPIRATIONS.filter(
    (item) =>
      item.title.toLowerCase().includes(kw) ||
      item.description.toLowerCase().includes(kw) ||
      item.tags.some((t) => t.toLowerCase().includes(kw))
  );
}

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
