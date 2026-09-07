import type {
  CapabilityRecord,
  IntegrationCertification,
  IntegrationId,
} from "./types";

export const HERMES_CAPABILITIES = [
  { id: "hermes.api", name: "API", required: true },
  { id: "hermes.auth", name: "Auth", required: true },
  { id: "hermes.models", name: "Models", required: true },
  { id: "hermes.chat", name: "Chat", required: true },
  { id: "hermes.streaming", name: "Streaming", required: false },
  { id: "hermes.runs", name: "Runs", required: false },
  { id: "hermes.run_status", name: "Run Status", required: false },
  { id: "hermes.cancel", name: "Cancel", required: false },
  { id: "hermes.tools", name: "Tools", required: false },
  { id: "hermes.skills", name: "Skills", required: false },
  { id: "hermes.mcp", name: "MCP", required: false },
  { id: "hermes.memory", name: "Memory", required: false },
  { id: "hermes.image", name: "Image", required: false },
  { id: "hermes.usage", name: "Usage", required: false },
] as const;

export const ZEABUR_CAPABILITIES = [
  { id: "zeabur.token", name: "API Token", required: true },
  { id: "zeabur.identity", name: "Identity", required: true },
  { id: "zeabur.project", name: "Project", required: false },
  { id: "zeabur.service", name: "Service", required: false },
  { id: "zeabur.environment", name: "Environment", required: false },
  { id: "zeabur.variables", name: "Variables keys", required: false },
] as const;

export const TAMKANG_CAPABILITIES = [
  { id: "tamkang.configured", name: "Configured", required: true },
  { id: "tamkang.reachable", name: "MCP reachable", required: false },
  { id: "tamkang.tools", name: "Tools list", required: false },
  { id: "tamkang.read", name: "Safe read", required: false },
] as const;

export const MEMORY_CAPABILITIES = [
  { id: "memory.local", name: "Console SQLite", required: true },
  { id: "memory.mcp", name: "Workspace MCP", required: false },
  { id: "memory.remote", name: "Hermes remote", required: false },
] as const;

export const CANVA_CAPABILITIES = [
  { id: "canva.configured", name: "OAuth configured", required: true },
  { id: "canva.list", name: "List designs", required: false },
  { id: "canva.create", name: "Create / autofill", required: false },
] as const;

export const MCP_CAPABILITIES = [
  { id: "mcp.bridge", name: "Bridge token", required: true },
  { id: "mcp.workspace", name: "Workspace MCP", required: false },
] as const;

export const RESEARCH_CAPABILITIES = [
  { id: "research.plan", name: "Plan", required: true },
  { id: "research.execute", name: "Executor", required: false },
  { id: "research.sources", name: "External sources", required: false },
] as const;

const INTEGRATIONS: Record<
  IntegrationId,
  { name: string; notice: string; caps: readonly { id: string; name: string; required: boolean }[] }
> = {
  hermes: {
    name: "Hermes",
    notice:
      "Models 清單成功只證明 API／Auth／Models。Chat、Runs、Tools、Memory、Image 必須分開驗證。",
    caps: HERMES_CAPABILITIES,
  },
  zeabur: {
    name: "Zeabur",
    notice:
      "自動驗證只讀：權杖、專案、服務、環境、變數鍵名。寫入環境變數／重啟／重新部署不在自動驗證內。",
    caps: ZEABUR_CAPABILITIES,
  },
  tamkang: {
    name: "淡江 MCP",
    notice: "tools/list 只是部分可用。沒有安全讀取證據不得標 verified。",
    caps: TAMKANG_CAPABILITIES,
  },
  canva: {
    name: "Canva",
    notice: "讀取設計清單不是製作成功。",
    caps: CANVA_CAPABILITIES,
  },
  memory: {
    name: "Memory",
    notice:
      "Console SQLite 是共用來源。synced 永遠為 false，除非完成遠端 write 後 read-back。",
    caps: MEMORY_CAPABILITIES,
  },
  mcp: {
    name: "MCP",
    notice: "Workspace MCP 與外部 MCP 分開。列出工具不是已驗證執行。",
    caps: MCP_CAPABILITIES,
  },
  research: {
    name: "Research",
    notice: "executed=true 只能在真的取得外部 evidence 之後。",
    caps: RESEARCH_CAPABILITIES,
  },
};

export function emptyCapability(
  integration: IntegrationId,
  spec: { id: string; name: string; required: boolean },
): CapabilityRecord {
  return {
    id: spec.id,
    integration,
    name: spec.name,
    status: "unknown",
    lastCheckedAt: null,
    lastVerifiedAt: null,
    latencyMs: null,
    evidence: null,
    message: "尚未檢查。",
    required: spec.required,
  };
}

export function emptyIntegration(id: IntegrationId): IntegrationCertification {
  const spec = INTEGRATIONS[id];
  return {
    id,
    name: spec.name,
    overall: "unknown",
    capabilities: spec.caps.map((cap) => emptyCapability(id, cap)),
    lastCheckedAt: null,
    notice: spec.notice,
  };
}

export function allIntegrationIds(): IntegrationId[] {
  return Object.keys(INTEGRATIONS) as IntegrationId[];
}

export function findCapability(
  report: IntegrationCertification,
  id: string,
): CapabilityRecord {
  const found = report.capabilities.find((item) => item.id === id);
  if (!found) throw new Error("unknown_capability:" + id);
  return found;
}
