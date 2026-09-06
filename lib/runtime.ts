import type { AgentProfile, CapabilityState } from "./server/agents";

export type RuntimeStatus =
  | "unknown"
  | "syncing"
  | "available"
  | "partial"
  | "unsupported"
  | "failed"
  | "stale";

export type ToolPermission = "read" | "draft" | "write" | "publish" | "destructive" | "confirm";

export interface ToolDescriptor {
  id: string;
  canonicalName: string;
  displayName: string;
  description: string;
  source: "hermes-native" | "mcp" | "console-workspace" | "oauth-api" | "project-api";
  sourceServer: string | null;
  toolset: string | null;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  permissions: ToolPermission[];
  readOnlyHint: boolean;
  supportsParallel: boolean;
  enabled: boolean;
  status: RuntimeStatus;
  lastSeenAt: string;
  lastVerifiedAt: string | null;
  projectScope: string[] | "all";
  agentScope: string[] | "all";
  metadata: Record<string, unknown>;
}

export interface RuntimeMcpServer {
  id: string;
  name: string;
  transport: string;
  authMode: string;
  projectScope: string[] | "all";
  enabled: boolean;
  status: RuntimeStatus;
  serverInfo: Record<string, unknown> | null;
  protocolVersion: string | null;
  capabilities: Record<string, unknown>;
  toolsCount: number;
  lastConnectedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
}

export interface HermesRuntimeSnapshot {
  id: "current";
  agentId: string;
  profileId: string;
  models: string[];
  capabilities: Record<string, boolean>;
  skills: Array<{ name: string; description: string; enabled?: boolean; tools?: string[] }>;
  toolsets: Array<{ name: string; description: string; enabled?: boolean; tools?: string[] }>;
  tools: ToolDescriptor[];
  mcpServers: RuntimeMcpServer[];
  agents: Array<Pick<AgentProfile, "id" | "name" | "displayName" | "description" | "status" | "role" | "enabled" | "lastVerifiedAt" | "lastError"> & {
    capabilities: Record<string, CapabilityState>;
    model: string | null;
  }>;
  sessionsSupport: RuntimeStatus;
  runsSupport: RuntimeStatus;
  memorySupport: RuntimeStatus;
  responsesSupport: RuntimeStatus;
  imageInputSupport: RuntimeStatus;
  source: "hermes-runtime";
  status: RuntimeStatus;
  fetchedAt: string;
  lastSyncedAt: string;
  lastVerifiedAt: string | null;
  hash: string;
  errors: string[];
  diagnostics: {
    snapshotAgeMs: number;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    durationMs: number;
    toolCount: number;
    skillCount: number;
    toolsetCount: number;
    mcpToolCount: number;
  };
}

export interface RuntimeDiff {
  from: string | null;
  to: string;
  added: string[];
  removed: string[];
  changed: string[];
  becameUnavailable: string[];
  recovered: string[];
  at: string;
}
