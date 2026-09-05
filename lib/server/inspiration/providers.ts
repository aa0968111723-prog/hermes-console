import {
  classifyInspirationUrl,
  instagramResearchLimits,
  listInspiration,
  pinterestResearchLimits,
  type InspirationItem,
  type InspirationPlatform,
} from "../inspiration";
import { canvaConfigured, canvaStatus } from "../canva";
import { WORKSPACE_OWNER } from "../security";
import { parseInspirationQuery, type InspirationQuery } from "./query";
import { canonicalUrl } from "./dedupe";

export interface ProviderCapabilities {
  search: boolean;
  resolveUrl: boolean;
  globalSearch: boolean;
  analyze: boolean;
}

export interface ProviderHealth {
  id: string;
  state: "unconfigured" | "partial" | "available" | "needs_authorization";
  detail: string;
  capabilities: ProviderCapabilities;
}

export interface InspirationProvider {
  id: string;
  name: string;
  platform: InspirationPlatform | "upload";
  isConfigured(): boolean;
  capabilities(): ProviderCapabilities;
  health(): ProviderHealth;
  search(query: InspirationQuery, projectId: string): InspirationItem[];
  resolveUrl(url: string, projectId: string): InspirationItem | null;
}

function none(): ProviderCapabilities {
  return { search: false, resolveUrl: false, globalSearch: false, analyze: false };
}

function storedMatch(platform: InspirationPlatform, projectId: string) {
  return listInspiration(projectId).filter((item) => item.platform === platform);
}

export const webProvider: InspirationProvider = {
  id: "web",
  name: "WebInspirationProvider",
  platform: "web",
  isConfigured: () => true,
  capabilities: () => ({
    search: false,
    resolveUrl: true,
    globalSearch: false,
    analyze: true,
  }),
  health: () => ({
    id: "web",
    state: "partial",
    detail: "可解析使用者 HTTPS 連結；不執行任意全網爬蟲。",
    capabilities: webProvider.capabilities(),
  }),
  search: (query, projectId) => storedMatch("web", projectId),
  resolveUrl: (url, projectId) =>
    classifyInspirationUrl(url) === "web"
      ? storedMatch("web", projectId).find((item) => canonicalUrl(item.sourceUrl) === canonicalUrl(url)) ||
        null
      : null,
};

export const instagramProvider: InspirationProvider = {
  id: "instagram",
  name: "InstagramReferenceProvider",
  platform: "instagram",
  isConfigured: () => true,
  capabilities: () => ({
    search: false,
    resolveUrl: true,
    globalSearch: false,
    analyze: true,
  }),
  health: () => {
    const limits = instagramResearchLimits();
    return {
      id: "instagram",
      state: limits.authorizedApi ? "needs_authorization" : "partial",
      detail: limits.notice,
      capabilities: instagramProvider.capabilities(),
    };
  },
  search: (_query, projectId) => storedMatch("instagram", projectId),
  resolveUrl: (url, projectId) =>
    classifyInspirationUrl(url) === "instagram"
      ? storedMatch("instagram", projectId).find(
          (item) => canonicalUrl(item.sourceUrl) === canonicalUrl(url),
        ) || null
      : null,
};

export const pinterestProvider: InspirationProvider = {
  id: "pinterest",
  name: "PinterestReferenceProvider",
  platform: "pinterest",
  isConfigured: () => true,
  capabilities: () => ({
    search: false,
    resolveUrl: true,
    globalSearch: false,
    analyze: true,
  }),
  health: () => ({
    id: "pinterest",
    state: pinterestResearchLimits().authorizedApi
      ? "needs_authorization"
      : "partial",
    detail: pinterestResearchLimits().notice,
    capabilities: pinterestProvider.capabilities(),
  }),
  search: (_query, projectId) => storedMatch("pinterest", projectId),
  resolveUrl: (url, projectId) =>
    classifyInspirationUrl(url) === "pinterest"
      ? storedMatch("pinterest", projectId).find(
          (item) => canonicalUrl(item.sourceUrl) === canonicalUrl(url),
        ) || null
      : null,
};

export const canvaProvider: InspirationProvider = {
  id: "canva",
  name: "CanvaReferenceProvider",
  platform: "canva",
  isConfigured: () => canvaConfigured(),
  capabilities: () => ({
    search: canvaConfigured(),
    resolveUrl: true,
    globalSearch: false,
    analyze: false,
  }),
  health: () => {
    const status = canvaStatus(WORKSPACE_OWNER);
    return {
      id: "canva",
      state: status.needsAuthorization
        ? "needs_authorization"
        : status.configured
          ? "partial"
          : "unconfigured",
      detail: status.needsAuthorization
        ? "Needs Canva Authorization"
        : status.message,
      capabilities: canvaProvider.capabilities(),
    };
  },
  search: (_query, projectId) => storedMatch("canva", projectId),
  resolveUrl: (url, projectId) =>
    classifyInspirationUrl(url) === "canva"
      ? storedMatch("canva", projectId).find(
          (item) => canonicalUrl(item.sourceUrl) === canonicalUrl(url),
        ) || null
      : null,
};

export const projectHistoryProvider: InspirationProvider = {
  id: "project",
  name: "ProjectHistoryProvider",
  platform: "project",
  isConfigured: () => true,
  capabilities: () => ({
    search: true,
    resolveUrl: false,
    globalSearch: false,
    analyze: false,
  }),
  health: () => ({
    id: "project",
    state: "available",
    detail: "只搜尋此工作區已保存的參考，不是外部平台。",
    capabilities: projectHistoryProvider.capabilities(),
  }),
  search: (_query, projectId) => listInspiration(projectId),
  resolveUrl: () => null,
};

export const uploadProvider: InspirationProvider = {
  id: "upload",
  name: "UserUploadProvider",
  platform: "upload",
  isConfigured: () => true,
  capabilities: () => ({
    search: false,
    resolveUrl: false,
    globalSearch: false,
    analyze: true,
  }),
  health: () => ({
    id: "upload",
    state: "available",
    detail: "分析使用者上傳的截圖／檔案；不是平台搜尋。",
    capabilities: uploadProvider.capabilities(),
  }),
  search: () => [],
  resolveUrl: () => null,
};

export const PROVIDERS: InspirationProvider[] = [
  instagramProvider,
  pinterestProvider,
  webProvider,
  canvaProvider,
  projectHistoryProvider,
  uploadProvider,
];

export function providerHealth() {
  return PROVIDERS.map((provider) => provider.health());
}

export function parseQuery(raw: string) {
  return parseInspirationQuery(raw);
}
