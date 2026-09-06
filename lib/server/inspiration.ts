import { z } from "zod";
import { ApiError, WORKSPACE_OWNER, hash, redact } from "./security";
import { get, list, put } from "./store";
import { canonicalUrl } from "./inspiration/dedupe";
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

export function classifyInspirationUrl(
  raw: string,
): InspirationPlatform | null {
  const parsed = httpsUrl.safeParse(raw);
  if (!parsed.success) return null;
  const host = new URL(parsed.data).hostname.replace(/^www\./, "");
  if (host === "instagram.com" || host.endsWith(".instagram.com"))
    return "instagram";
  if (
    host === "pinterest.com" ||
    host.endsWith(".pinterest.com") ||
    host === "pin.it"
  )
    return "pinterest";
  if (host === "behance.net" || host.endsWith(".behance.net")) return "behance";
  if (host === "dribbble.com" || host.endsWith(".dribbble.com"))
    return "dribbble";
  if (host === "canva.com" || host.endsWith(".canva.com")) return "canva";
  return "web";
}

export function parseHashtags(text: string) {
  return [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)]
    .map((match) => match[1])
    .slice(0, 30);
}

export function ingestUrl(input: {
  url: string;
  projectId: string;
  caption?: string;
  account?: string;
  media?: string;
  sourceType?: InspirationItem["sourceType"];
}): InspirationItem {
  if (
    input.projectId !== "personal" &&
    !get("project", WORKSPACE_OWNER, input.projectId)
  )
    throw new ApiError(404, "project_not_found", "專案不存在。");
  if (redact(JSON.stringify(input)) !== JSON.stringify(input))
    throw new ApiError(400, "sensitive_content", "參考資訊不能包含憑證。");
  const url = canonicalUrl(httpsUrl.parse(input.url));
  const duplicate = listInspiration(input.projectId).find(
    (item) => canonicalUrl(item.sourceUrl) === url,
  );
  if (duplicate) return duplicate;
  const platform = classifyInspirationUrl(url);
  if (!platform) throw new ApiError(400, "invalid_url", "無法辨識此靈感網址。");
  const item: InspirationItem = {
    id: hash(input.projectId + "\n" + url),
    image: input.media || null,
    platform,
    sourceUrl: url,
    account: input.account || null,
    captionExcerpt: input.caption
      ? wrapUntrusted("caption", input.caption).slice(0, 500)
      : null,
    media: input.media || null,
    hashtags: parseHashtags(input.caption || ""),
    analysis: "已收藏使用者提供的來源連結；尚未宣稱已搜尋該平台全站。",
    borrow: [],
    fit: "待 Hermes 依真實內容分析。",
    risk: "參考素材不代表可用於正式發佈。",
    collectedAt: new Date().toISOString(),
    projectId: input.projectId,
    sourceType: "user_url",
    saved: true,
  };
  return put("inspiration", WORKSPACE_OWNER, item);
}

export function listInspiration(projectId?: string) {
  const items = list<InspirationItem>("inspiration", WORKSPACE_OWNER);
  return projectId
    ? items.filter((item) => item.projectId === projectId)
    : items;
}

export function instagramResearchLimits() {
  const authorized = !!(
    process.env.INSTAGRAM_CLIENT_ID && process.env.INSTAGRAM_CLIENT_SECRET
  );
  return {
    fullSiteSearch: false,
    configured: authorized,
    authorizedApi: false,
    modes: ["user_url"],
    notice:
      "目前只保存使用者提供的連結與描述，沒有執行 Instagram 官方搜尋或抓取貼文。Client 設定不等於已取得使用者授權。",
  };
}

export function pinterestResearchLimits() {
  const authorized = !!(
    process.env.PINTEREST_CLIENT_ID && process.env.PINTEREST_CLIENT_SECRET
  );
  return {
    fullSiteSearch: false,
    configured: authorized,
    authorizedApi: false,
    notice: "目前只收藏 Pin／看板 HTTPS 連結，沒有讀取看板內容或執行官方搜尋。",
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
