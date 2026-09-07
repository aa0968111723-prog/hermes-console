import type { FallbackRecord } from "../../contracts";
import type { RoutedTool } from "./tool-router";

export function fallbacksFromRoutes(routes: RoutedTool[]): FallbackRecord[] {
  return routes
    .filter((route) => route.tool !== "tamkang_mcp" && route.fallback)
    .map((route) => ({
      from: route.id === "campus" ? "tamkang_mcp" : route.tool,
      to: route.tool,
      reason: route.reason,
      userVisible: userVisibleFallback(route),
    }));
}

export function userVisibleFallback(route: RoutedTool) {
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
