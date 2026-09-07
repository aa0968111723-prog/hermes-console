import { hash, ApiError } from "../security";
import { health } from "../hermes";
import { listAgents, capabilityFromHealth, publicProfile } from "../agents";
import { seedRegistry, probeMcp, type McpEntry } from "../mcp-registry";
import { toolsList } from "../mcp";
import { get, list, put } from "../store";
import type { Health } from "../../contracts";
import type { HermesRuntimeSnapshot, RuntimeDiff, RuntimeMcpServer, RuntimeStatus, ToolDescriptor, ToolPermission } from "../../runtime";
import { UnifiedToolRegistry } from "../tool-registry";
import { credentialPresence } from "../credentials";

const globalState = globalThis as typeof globalThis & {
  hermesRuntimeSync?: Map<string, Promise<HermesRuntimeSnapshot>>;
};
const inflight = (globalState.hermesRuntimeSync ??= new Map());

function statusFromHealth(value: Health): RuntimeStatus {
  if (value.status === "unconfigured") return "unknown";
  if (value.status === "failed") return "failed";
  if (value.status === "available") return "available";
  return value.credential === "valid" ? "partial" : "unknown";
}
function permissionFor(name: string, description: string, schema: Record<string, unknown>, annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }): ToolPermission[] {
  if (annotations?.destructiveHint) return ["destructive", "confirm"];
  if (annotations?.readOnlyHint) return ["read"];
  const text = (name + " " + description + " " + JSON.stringify(schema)).toLowerCase();
  if (/delete|remove|revoke|destroy|drop|overwrite|reset/.test(text)) return ["destructive", "confirm"];
  if (/publish|post|send|schedule|export/.test(text)) return ["publish", "confirm"];
  if (/create|update|edit|write|upload|save|modify/.test(text)) return ["write", "confirm"];
  if (/draft|generate|compose|design/.test(text)) return ["draft"];
  return ["read"];
}
function statusForMcp(status: McpEntry["status"]): RuntimeStatus {
  if (status === "verified") return "available";
  if (status === "partial" || status === "connected") return "partial";
  if (status === "failed") return "failed";
  return "unknown";
}
function sanitizeMcp(entry: McpEntry): RuntimeMcpServer {
  const last = entry.verifiedAt;
  return {
    id: entry.id, name: entry.name, transport: entry.transport, authMode: entry.authMode,
    projectScope: "all", enabled: entry.status !== "unconfigured" || entry.id === "workspace",
    status: statusForMcp(entry.status), serverInfo: null, protocolVersion: null,
    capabilities: {}, toolsCount: entry.tools.length, lastConnectedAt: last,
    lastSyncedAt: last, lastError: entry.lastError, metadata: { trustedLevel: entry.trustedLevel, readonly: entry.readonly },
  };
}
function descriptorFromHermes(toolset: { name: string; description: string; enabled?: boolean; tools?: string[] }, name: string, at: string, status: RuntimeStatus): ToolDescriptor {
  const canonicalName = "hermes." + toolset.name + "." + name;
  return {
    id: hash("hermes-native|" + canonicalName), canonicalName, displayName: name,
    description: toolset.description || "Hermes 原生工具", source: "hermes-native", sourceServer: "hermes",
    toolset: toolset.name, inputSchema: {}, permissions: permissionFor(name, toolset.description, {}),
    readOnlyHint: permissionFor(name, toolset.description, {})[0] === "read", supportsParallel: true,
    enabled: toolset.enabled !== false, status, lastSeenAt: at, lastVerifiedAt: at,
    projectScope: "all", agentScope: "all", metadata: { runtimeName: name },
  };
}
function descriptorFromMcp(server: McpEntry, tool: McpEntry["tools"][number], at: string): ToolDescriptor {
  const canonicalName = "mcp." + server.id + "." + tool.name;
  const permissions = permissionFor(tool.name, tool.description, tool.inputSchema || {}, tool.annotations);
  return {
    id: hash("mcp|" + server.id + "|" + tool.name), canonicalName, displayName: tool.name,
    description: tool.description, source: "mcp", sourceServer: server.id, toolset: null,
    inputSchema: tool.inputSchema || {}, permissions, readOnlyHint: permissions[0] === "read", supportsParallel: permissions[0] === "read",
    enabled: server.status === "verified" || server.status === "partial", status: statusForMcp(server.status),
    lastSeenAt: at, lastVerifiedAt: server.verifiedAt, projectScope: "all", agentScope: "all",
    metadata: { serverName: server.name, transport: server.transport },
  };
}
function descriptorFromConsole(name: string, description: string, schema: Record<string, unknown>, at: string): ToolDescriptor {
  const permissions = permissionFor(name, description, schema);
  return {
    id: hash("console-workspace|" + name), canonicalName: "console-workspace." + name, displayName: name,
    description, source: "console-workspace", sourceServer: "workspace", toolset: "workspace",
    inputSchema: schema, permissions, readOnlyHint: permissions[0] === "read", supportsParallel: permissions[0] === "read",
    enabled: true, status: "available", lastSeenAt: at, lastVerifiedAt: at, projectScope: "all", agentScope: "all", metadata: {},
  };
}
function previous(owner: string) { return get<HermesRuntimeSnapshot>("runtime_snapshot", owner, "current"); }
export function runtimeSnapshot(owner: string) { return previous(owner); }
export function runtimeDiff(before: HermesRuntimeSnapshot | null, after: HermesRuntimeSnapshot): RuntimeDiff {
  const old = new Map((before?.tools || []).map(t => [t.canonicalName, t]));
  const next = new Map(after.tools.map(t => [t.canonicalName, t]));
  const added = [...next.keys()].filter(k => !old.has(k));
  const removed = [...old.keys()].filter(k => !next.has(k));
  const stable = (tool: ToolDescriptor | undefined) => tool && hash(JSON.stringify({ ...tool, lastSeenAt: "", lastVerifiedAt: null }));
  const changed = [...next.keys()].filter(k => old.has(k) && stable(old.get(k)) !== stable(next.get(k)));
  const becameUnavailable = [...next.keys()].filter(k => old.get(k)?.status === "available" && next.get(k)?.status !== "available");
  const recovered = [...next.keys()].filter(k => old.get(k) && old.get(k)!.status !== "available" && next.get(k)?.status === "available");
  return { from: before?.hash || null, to: after.hash, added, removed, changed, becameUnavailable, recovered, at: new Date().toISOString() };
}
async function discover(owner: string, force: boolean): Promise<HermesRuntimeSnapshot> {
  const started = Date.now();
  const before = previous(owner);
  let connection: Health;
  const errors: string[] = [];
  try { connection = await health(owner, force); }
  catch (error) {
    if (before) {
      const stale = { ...before, status: "stale" as const, fetchedAt: new Date().toISOString(), diagnostics: { ...before.diagnostics, snapshotAgeMs: Date.now() - Date.parse(before.lastSyncedAt), durationMs: Date.now() - started }, errors: ["Hermes discovery 失敗，沿用最後快照。"] };
      put("runtime_snapshot", owner, stale);
      return stale;
    }
    throw error;
  }
  if (before && connection.status === "failed") {
    const stale = {
      ...before,
      status: "stale" as const,
      fetchedAt: new Date().toISOString(),
      diagnostics: { ...before.diagnostics, snapshotAgeMs: Date.now() - Date.parse(before.lastSyncedAt), durationMs: Date.now() - started },
      errors: ["Hermes discovery 失敗，沿用最後快照；目前工具狀態不是最新。"],
    };
    put("runtime_snapshot", owner, stale);
    return stale;
  }
  const at = new Date().toISOString();
  const hermesStatus = statusFromHealth(connection);
  const tools: ToolDescriptor[] = [];
  for (const set of connection.toolsets) for (const name of set.tools || []) tools.push(descriptorFromHermes(set, name, at, hermesStatus));
  let mcpEntries: McpEntry[] = [];
  try {
    mcpEntries = seedRegistry();
    if (force) {
      const probes = await Promise.all(mcpEntries.filter(e => e.id !== "workspace" && e.endpoint).map(async entry => probeMcp(entry)));
      const byId = new Map(probes.map(e => [e.id, e]));
      mcpEntries = mcpEntries.map(e => byId.get(e.id) || e);
    }
  } catch (error) { errors.push(error instanceof ApiError ? error.message : "MCP registry 讀取失敗。"); }
  for (const entry of mcpEntries) for (const tool of entry.tools) tools.push(descriptorFromMcp(entry, tool, at));
  try {
    for (const tool of toolsList(owner)) tools.push(descriptorFromConsole(tool.name, tool.description, tool.inputSchema as Record<string, unknown>, at));
  } catch { errors.push("Workspace MCP 工具清單無法讀取。"); }
  const capabilities = connection.features || {};
  const capability = (key: string, fallback: RuntimeStatus = "unsupported"): RuntimeStatus => capabilities[key] === true ? "available" : capabilities[key] === false ? "unsupported" : fallback;
  const profiles = listAgents().filter(p => p.role === "general" || p.status !== "unconfigured").map(p => {
    if (p.role !== "general") return { id:p.id,name:p.name,displayName:p.displayName,description:p.description,status:p.status,role:p.role,enabled:p.enabled,lastVerifiedAt:p.lastVerifiedAt,lastError:p.lastError,capabilities:p.capabilities,model:p.model };
    const states = capabilityFromHealth(connection);
    return { id:p.id,name:p.name,displayName:p.displayName,description:p.description,status:connection.status === "failed" ? "failed" : connection.credential === "valid" ? "reachable" : p.status,role:p.role,enabled:p.enabled,lastVerifiedAt:connection.checkedAt,lastError:connection.status === "failed" ? connection.message : null,capabilities:states,model:connection.models[0] || p.model };
  });
  const snapshotBase = {
    id:"current" as const, agentId:"hermes", profileId:"general", models:connection.models, capabilities, skills:connection.skills, toolsets:connection.toolsets, tools,
    mcpServers:mcpEntries.map(sanitizeMcp), agents:profiles, sessionsSupport: capability("session_resources", "unsupported"), runsSupport: capability("run_submission", "unsupported"), memorySupport: capability("memory", "unsupported"), responsesSupport: capability("responses", "unsupported"), imageInputSupport: process.env.HERMES_IMAGE_INPUT === "true" ? "available" as const : "unsupported" as const,
    source:"hermes-runtime" as const, status: errors.length ? "partial" as const : hermesStatus, fetchedAt:at, lastSyncedAt:at, lastVerifiedAt:connection.credential === "valid" ? at : null, errors,
  };
  const registry = new UnifiedToolRegistry().registerMany(tools);
  const normalizedTools = registry.all();
  const snapshotWithTools = { ...snapshotBase, tools: normalizedTools };
  const stableNormalized = { ...snapshotWithTools, fetchedAt: "", lastSyncedAt: "", tools: normalizedTools.map(tool => ({ ...tool, lastSeenAt: "", lastVerifiedAt: null })) };
  const snapshot = { ...snapshotWithTools, hash: hash(JSON.stringify(stableNormalized)), diagnostics: { snapshotAgeMs:0, lastSuccessAt:at, lastFailureAt:errors.length ? at : before?.diagnostics.lastFailureAt || null, durationMs:Date.now()-started, toolCount:normalizedTools.length, skillCount:connection.skills.length, toolsetCount:connection.toolsets.length, mcpToolCount:mcpEntries.reduce((n,e)=>n+e.tools.length,0), hermesUrlSource: credentialPresence("HERMES_API_URL").source, hermesKeySource: credentialPresence("HERMES_API_KEY").source } } satisfies HermesRuntimeSnapshot;
  if (!before || before.hash !== snapshot.hash) put("runtime_snapshot", owner, snapshot);
  put("runtime_diff", owner, { id: snapshot.hash, ...runtimeDiff(before, snapshot) });
  return snapshot;
}
export async function syncRuntime(owner: string, options: { force?: boolean } = {}) {
  const current = previous(owner);
  const age = current ? Date.now() - Date.parse(current.lastSyncedAt) : Infinity;
  if (!options.force && current && age < 30_000) return current;
  const existing = inflight.get(owner);
  if (existing) return existing;
  const promise = discover(owner, !!options.force).finally(() => inflight.delete(owner));
  inflight.set(owner, promise);
  return promise;
}
export function runtimeTools(owner: string, projectId?: string, agentId?: string) {
  const snapshot = previous(owner);
  if (!snapshot) return [];
  const bindings = projectId ? list<ToolBinding>("runtime_binding", owner).filter(binding => binding.projectId === projectId && (!binding.agentId || !agentId || binding.agentId === agentId)) : [];
  return snapshot.tools.filter(tool =>
    tool.enabled && (tool.projectScope === "all" || !!projectId && tool.projectScope.includes(projectId)) && (tool.agentScope === "all" || !!agentId && tool.agentScope.includes(agentId)),
  ).filter(tool => {
    const binding = bindings.find(item => item.toolName === tool.canonicalName);
    if (!binding) return true;
    if (!binding.enabled || binding.blockedTools.includes(tool.canonicalName)) return false;
    return !binding.allowedTools.length || binding.allowedTools.includes(tool.canonicalName);
  }).sort((a, b) => {
    const pa = bindings.find(item => item.toolName === a.canonicalName)?.priority || 0;
    const pb = bindings.find(item => item.toolName === b.canonicalName)?.priority || 0;
    return pb - pa;
  });
}

export type ToolBinding = { id: string; projectId: string; agentId?: string; toolName: string; enabled: boolean; priority: number; allowedTools: string[]; blockedTools: string[]; permissionOverrides: Record<string, string> };
export function listRuntimeBindings(owner: string, projectId?: string) {
  return list<ToolBinding>("runtime_binding", owner).filter(binding => !projectId || binding.projectId === projectId);
}
export function saveRuntimeBinding(owner: string, input: Omit<ToolBinding, "id">) {
  const snapshot = previous(owner);
  if (!snapshot) throw new ApiError(409, "runtime_not_synced", "請先同步 Hermes Runtime，再設定工具綁定。");
  if (input.projectId !== "personal" && !get("project", owner, input.projectId)) throw new ApiError(404, "project_not_found", "專案不存在。");
  if (!snapshot.tools.some(tool => tool.canonicalName === input.toolName)) throw new ApiError(404, "runtime_tool_not_found", "此工具不在目前 Runtime 清單，不能綁定。");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(input.projectId) || (input.agentId && !/^[a-zA-Z0-9_-]{1,100}$/.test(input.agentId))) throw new ApiError(400, "binding_scope_invalid", "專案或 Agent 識別格式錯誤。");
  const id = hash([input.projectId, input.agentId || "", input.toolName].join("|"));
  return put("runtime_binding", owner, { ...input, id });
}
