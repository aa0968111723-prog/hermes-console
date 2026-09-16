import { permissionClass } from "../permissions";

const USABLE = new Set(["partial", "verified", "connected"]);

export type PlannerCatalogEntry = {
  id: string;
  name: string;
  status: string;
  trustedLevel?: string;
  readonly?: boolean;
  tools?: Array<{ name: string }>;
  endpoint?: string;
  credentialReference?: string | null;
  lastError?: string | null;
};

export function formatPlannerCatalog(entries: PlannerCatalogEntry[]): string {
  const lines = entries.map((entry) => {
    const usable = USABLE.has(entry.status);
    const tools = (entry.tools || []).slice(0, 8).map((item) => item.name);
    const permission = tools[0]
      ? permissionClass(tools[0])
      : entry.readonly
        ? "read"
        : "write";
    return (
      "- " +
      entry.id +
      " · " +
      entry.name +
      " · status=" +
      entry.status +
      " · trust=" +
      (entry.trustedLevel || "untrusted") +
      " · permission=" +
      permission +
      " · availability=" +
      (usable ? "usable" : "unavailable") +
      " · cost=unknown" +
      (tools.length ? " · tools=" + tools.join(",") : "") +
      (usable ? "" : " · 不可用，不要呼叫")
    );
  });
  return [
    "目前工具可用性（只給你選用。不要向使用者展示端點、參數結構、憑證參照或內部 tool id）：",
    ...(lines.length ? lines : ["- 目前沒有已登錄的 MCP。"]),
    "cost 為 unknown 時不得當成 0。listTools 的 connected／partial 不是全部工具已驗證。",
  ].join("\n");
}
