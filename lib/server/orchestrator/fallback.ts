import type { FallbackRecord } from "../../contracts";
import type { RoutedTool } from "./tool-router";

export function fallbacksFromRoutes(routes: RoutedTool[]): FallbackRecord[] {
  const primary = new Set([
    "tamkang_mcp",
    "galley_research",
    "xunhe_research",
    "lumen_utter",
    "framelab_list_projects",
    "planform_run_agent",
  ]);
  return routes
    .filter((route) => !primary.has(route.tool) && route.fallback)
    .map((route) => ({
      from: route.id === "campus" ? "tamkang_mcp" : route.tool,
      to: route.fallback || route.tool,
      reason: route.reason,
      userVisible: userVisibleFallback(route),
    }));
}

export function userVisibleFallback(route: RoutedTool) {
  if (route.id === "research") return route.reason;
  if (route.id === "galley")
    return "研究情報未連線或失敗時改用已授權網頁；不會假裝已搜尋 GALLEY 或完整 Instagram。";
  if (route.id === "lumen")
    return "創作台未連線時只整理規格，不會假裝已開畫板。";
  if (route.id === "framelab")
    return "動畫工具未連線時會說明無法改像素，不會假裝已修格。";
  if (route.id === "planform")
    return "場佈工具未連線時不會假裝已排版。";
  if (route.id === "image")
    return "圖片已保存，但此部署尚未驗證看圖，不會假裝已讀像素。";
  if (route.tool === "hermes_authorized_web")
    return "淡江 MCP 暫時不可用，已改用 Hermes 已授權網頁來源。";
  if (route.tool === "official_web_directory")
    return "尚未執行查詢；目前只能提供待查官方入口，不會用模型自行補資料。";
  if (route.tool === "ask_user")
    return "需要的資料來源目前都不可用，會先問你要提供連結或稍後再試。";
  if (route.tool === "canva_spec_only")
    return "Canva 尚未授權，只會整理可製作規格，不會假裝設計已完成。";
  return route.reason;
}

export function formatFallbacksForUser(records: FallbackRecord[]) {
  if (!records.length) return "";
  return records.map((item) => "· " + item.userVisible).join("\n");
}
