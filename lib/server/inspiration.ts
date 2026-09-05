import { z } from "zod";
import { ApiError, WORKSPACE_OWNER } from "./security";
import { list, put } from "./store";
import { wrapUntrusted } from "./untrusted";

export type InspirationPlatform =
  | "instagram"
  | "pinterest"
  | "behance"
  | "dribbble"
  | "web"
  | "canva"
  | "project";

export interface InspirationItem {
  id: string;
  image: string | null;
  platform: InspirationPlatform;
  sourceUrl: string;
  account: string | null;
  captionExcerpt: string | null;
  media: string | null;
  hashtags: string[];
  analysis: string;
  borrow: string[];
  fit: string;
  risk: string;
  collectedAt: string;
  projectId: string;
  sourceType: "user_url" | "web_search" | "public_index" | "authorized_api";
  saved: boolean;
}

const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  }, "只接受不含帳密的公開 HTTPS 網址。");

export function classifyInspirationUrl(raw: string): InspirationPlatform | null {
  const parsed = httpsUrl.safeParse(raw);
  if (!parsed.success) return null;
  const host = new URL(parsed.data).hostname.replace(/^www\./, "");
  if (host === "instagram.com" || host.endsWith(".instagram.com"))
    return "instagram";
  if (host === "pinterest.com" || host.endsWith(".pinterest.com") || host === "pin.it")
    return "pinterest";
  if (host === "behance.net" || host.endsWith(".behance.net")) return "behance";
  if (host === "dribbble.com" || host.endsWith(".dribbble.com")) return "dribbble";
  if (host === "canva.com" || host.endsWith(".canva.com")) return "canva";
  return "web";
}

export function parseHashtags(text: string) {
  return [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((match) => match[1]).slice(0, 30);
}

export function ingestUrl(input: {
  url: string;
  projectId: string;
  caption?: string;
  account?: string;
  media?: string;
  sourceType?: InspirationItem["sourceType"];
}): InspirationItem {
  const url = httpsUrl.parse(input.url);
  const platform = classifyInspirationUrl(url);
  if (!platform)
    throw new ApiError(400, "invalid_url", "無法辨識此靈感網址。");
  const item: InspirationItem = {
    id: Buffer.from(url).toString("base64url").slice(0, 48),
    image: input.media || null,
    platform,
    sourceUrl: url,
    account: input.account || null,
    captionExcerpt: input.caption ? wrapUntrusted("caption", input.caption).slice(0, 500) : null,
    media: input.media || null,
    hashtags: parseHashtags(input.caption || ""),
    analysis: "已收藏使用者提供的來源連結；尚未宣稱已搜尋該平台全站。",
    borrow: [],
    fit: "待 Hermes 依真實內容分析。",
    risk: "參考素材不代表可用於正式發佈。",
    collectedAt: new Date().toISOString(),
    projectId: input.projectId,
    sourceType: input.sourceType || "user_url",
    saved: true,
  };
  return put("inspiration", WORKSPACE_OWNER, item);
}

export function listInspiration(projectId?: string) {
  const items = list<InspirationItem>("inspiration", WORKSPACE_OWNER);
  return projectId ? items.filter((item) => item.projectId === projectId) : items;
}

export function instagramResearchLimits() {
  const authorized = !!(
    process.env.INSTAGRAM_CLIENT_ID && process.env.INSTAGRAM_CLIENT_SECRET
  );
  return {
    fullSiteSearch: false,
    authorizedApi: authorized,
    modes: authorized
      ? ["user_url", "web_search", "authorized_api"]
      : ["user_url", "web_search", "public_index"],
    notice: "不能搜尋完整 Instagram。未授權時只能收藏公開連結、網頁索引或使用者上傳。",
  };
}

export function pinterestResearchLimits() {
  const authorized = !!(
    process.env.PINTEREST_CLIENT_ID && process.env.PINTEREST_CLIENT_SECRET
  );
  return {
    fullSiteSearch: false,
    authorizedApi: authorized,
    notice: "未授權時僅支援 Pin／看板 HTTPS 連結與網頁搜尋摘要，不是官方全站搜尋。",
  };
}

export function inspirationSearchPlan(prompt: string) {
  void prompt;
  return [
    "instagram",
    "pinterest",
    "web",
    "canva",
    "behance",
    "dribbble",
    "project",
  ] as InspirationPlatform[];
}
