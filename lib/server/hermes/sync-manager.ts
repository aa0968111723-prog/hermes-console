import { hash } from "../security";
import { health, serviceIdentity } from "../hermes";
import { listAgents, capabilityFromHealth } from "../agents";
import {
  configuredMcp,
  seedRegistry,
  probeMcp,
  type McpEntry,
} from "../mcp-registry";
import { toolsList } from "../mcp";
import { get, put, transaction } from "../store";
import type { Health } from "../../contracts";
import type {
  HermesRuntimeSnapshot,
  RuntimeDiff,
  RuntimeStatus,
  ToolDescriptor,
} from "../../runtime";
import { UnifiedToolRegistry } from "../tool-registry";
export { listRuntimeBindings, saveRuntimeBinding } from "./tool-policy";
import { filterBoundTools } from "./tool-policy";
import { credentialPresence, runtimeEnv } from "../credentials";

export const RUNTIME_INTERVAL_MS = 30_000;
export const RUNTIME_STALE_MS = 180_000;
type SyncMeta = {
  id: "current";
  fetchedAt: string;
  lastSyncedAt: string;
  diagnostics: HermesRuntimeSnapshot["diagnostics"];
};
type Listener = (snapshot: HermesRuntimeSnapshot, diff: RuntimeDiff) => void;
type State = {
  inflight?: Promise<HermesRuntimeSnapshot>;
  identity?: string;
  nextAttemptAt: number;
  failures: number;
  listeners: Set<Listener>;
};
const globalState = globalThis as typeof globalThis & {
  hermesRuntimeStatesV2?: Map<string, State>;
};
const states = (globalState.hermesRuntimeStatesV2 ??= new Map<string, State>());
function stateFor(owner: string) {
  let state = states.get(owner);
  if (!state) {
    state = { nextAttemptAt: 0, failures: 0, listeners: new Set() };
    states.set(owner, state);
  }
  return state;
}
export function subscribeRuntime(owner: string, listener: Listener) {
  const listeners = stateFor(owner).listeners;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function runtimeSyncInflight(owner: string) {
  return Boolean(stateFor(owner).inflight);
}
function previous(owner: string) {
  const snapshot = get<HermesRuntimeSnapshot>(
    "runtime_snapshot",
    owner,
    "current",
  );
  const meta = get<SyncMeta>("runtime_sync", owner, "current");
  return snapshot && meta ? { ...snapshot, ...meta } : snapshot;
}
export function runtimeSnapshot(owner: string): HermesRuntimeSnapshot | null {
  const snapshot = previous(owner);
  if (!snapshot) return null;
  const age = Date.now() - Date.parse(snapshot.fetchedAt);
  const expired = !Number.isFinite(age) || age > RUNTIME_STALE_MS;
  return {
    ...snapshot,
    ...(expired
      ? {
          status: "stale" as const,
          tools: snapshot.tools.map((tool) => ({
            ...tool,
            status: "stale" as const,
          })),
        }
      : {}),
    diagnostics: { ...snapshot.diagnostics, snapshotAgeMs: Math.max(0, age) },
  };
}

// Sort object keys, not schema arrays. Observation times are removed explicitly,
// so schema properties named 'lastVerifiedAt' still participate in the hash.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const stableTool = (tool: ToolDescriptor) => ({
  ...tool,
  lastSeenAt: "",
  lastVerifiedAt: null,
  metadata: { ...tool.metadata, discoveredAt: undefined },
});
export function runtimeContentHash(
  snapshot: Omit<HermesRuntimeSnapshot, "hash" | "diagnostics">,
) {
  return hash(
    JSON.stringify(
      canonical({
        ...snapshot,
        fetchedAt: "",
        lastSyncedAt: "",
        lastVerifiedAt: null,
        models: [...snapshot.models].sort(),
        skills: [...snapshot.skills].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
        toolsets: snapshot.toolsets
          .map((set) => ({ ...set, tools: set.tools && [...set.tools].sort() }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        tools: snapshot.tools
          .map(stableTool)
          .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName)),
        agents: snapshot.agents
          .map((agent) => ({ ...agent, lastVerifiedAt: null }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        mcpServers: snapshot.mcpServers
          .map((server) => ({
            ...server,
            lastSyncedAt: null,
            lastConnectedAt: null,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }),
    ),
  );
}
const usable = (tool?: ToolDescriptor) =>
  !!tool?.enabled && ["available", "partial"].includes(tool.status);
export function runtimeDiff(
  before: HermesRuntimeSnapshot | null,
  after: HermesRuntimeSnapshot,
): RuntimeDiff {
  const old = new Map((before?.tools || []).map((t) => [t.canonicalName, t]));
  const next = new Map(after.tools.map((t) => [t.canonicalName, t]));
  return {
    from: before?.hash || null,
    to: after.hash,
    added: [...next.keys()].filter((k) => !old.has(k)),
    removed: [...old.keys()].filter((k) => !next.has(k)),
    changed: [...next.keys()].filter(
      (k) =>
        old.has(k) &&
        JSON.stringify(canonical(stableTool(old.get(k)!))) !==
          JSON.stringify(canonical(stableTool(next.get(k)!))),
    ),
    becameUnavailable: [...old.keys()].filter(
      (k) => usable(old.get(k)) && !usable(next.get(k)),
    ),
    recovered: [...next.keys()].filter(
      (k) => old.has(k) && !usable(old.get(k)) && usable(next.get(k)),
    ),
    at: new Date().toISOString(),
  };
}
function mcpStatus(entry: McpEntry): RuntimeStatus {
  if (!entry.enabled) return "unknown";
  return entry.status === "failed"
    ? "failed"
    : ["partial", "verified"].includes(entry.status)
      ? "partial"
      : "unknown";
}
function descriptor(
  name: string,
  at: string,
  source: ToolDescriptor["source"],
  server: string,
  canonicalName: string,
): ToolDescriptor {
  return {
    id: hash(canonicalName),
    canonicalName,
    displayName: name,
    description: "",
    source,
    sourceServer: server,
    toolset: null,
    inputSchema: {},
    permissions: ["confirm"],
    readOnlyHint: false,
    supportsParallel: false,
    enabled: true,
    status: "partial",
    lastSeenAt: at,
    lastVerifiedAt: null,
    projectScope: "all",
    agentScope: "all",
    metadata: { executionVerified: false },
  };
}
async function discover(owner: string): Promise<HermesRuntimeSnapshot> {
  const started = Date.now(),
    before = previous(owner);
  // MCP remains independent when Hermes is offline. Bound simultaneous MCP probes.
  const mcpPromise = (async () => {
    const entries = seedRegistry(),
      results: McpEntry[] = [];
    const budget = AbortSignal.timeout(25_000);
    for (let i = 0; i < entries.length; i += 4)
      results.push(
        ...(await Promise.all(
          entries.slice(i, i + 4).map(async (entry) => {
            if (entry.id === "workspace" || !entry.endpoint || !entry.enabled)
              return entry;
            try {
              budget.throwIfAborted();
              return await probeMcp(entry, budget);
            } catch {
              return {
                ...entry,
                tools: [],
                status: "failed" as const,
                verifiedAt: null,
                lastError: "本輪探索未完成；稍後重試。",
              };
            }
          }),
        )),
      );
    return results;
  })();
  const [hermesResult, mcpResult] = await Promise.allSettled([
    health(owner, true),
    mcpPromise,
  ]);
  const connection: Health | null =
    hermesResult.status === "fulfilled" ? hermesResult.value : null;
  const at = new Date().toISOString(),
    errors: string[] = [];
  const online =
    !!connection &&
    connection.credential === "valid" &&
    connection.status !== "failed";
  const nativeFailed = !online || connection?.discovery?.toolsets === "failed";
  if (!online)
    errors.push(
      connection?.message || "Hermes discovery 失敗，請檢查部署與憑證。",
    );
  for (const [kind, status] of Object.entries(connection?.discovery || {}))
    if (status === "failed")
      errors.push(`Hermes ${kind} 探索失敗；舊資料僅供參考。`);
  const tools: ToolDescriptor[] = [];
  if (nativeFailed) {
    tools.push(
      ...(before?.tools || [])
        .filter((t) => t.source === "hermes-native")
        .map((t) => ({ ...t, status: "stale" as const })),
    );
  } else {
    for (const set of connection!.toolsets)
      for (const name of set.tools || [])
        tools.push({
          ...descriptor(
            name,
            at,
            "hermes-native",
            "hermes",
            `hermes.${set.name}.${name}`,
          ),
          description: set.description,
          toolset: set.name,
          enabled: set.enabled !== false && set.configured !== false,
          metadata: {
            executionVerified: false,
            schemaAvailable: false,
            runtimeName: name,
            bindingSupported: false,
          },
        });
  }
  const entries = mcpResult.status === "fulfilled" ? mcpResult.value : [];
  if (mcpResult.status === "rejected")
    errors.push("MCP 核准清單或探索失敗，請檢查後端設定。");
  for (const entry of entries) {
    if (entry.enabled && ["failed", "connected"].includes(entry.status))
      errors.push(`MCP ${entry.id} 探索失敗；請檢查授權或服務。`);
    for (const tool of entry.tools)
      tools.push({
        ...descriptor(
          tool.name,
          at,
          "mcp",
          entry.id,
          `mcp.${entry.id}.${tool.name}`,
        ),
        description: tool.description,
        inputSchema: tool.inputSchema || {},
        outputSchema: tool.outputSchema,
        // Remote annotations are hints, never permission grants.
        permissions: tool.annotations?.destructiveHint
          ? ["destructive", "confirm"]
          : ["confirm"],
        readOnlyHint: tool.annotations?.readOnlyHint === true,
        enabled: entry.enabled,
        status: mcpStatus(entry),
        metadata: {
          executionVerified: false,
          discoveredAt: entry.verifiedAt,
          bindingSupported: false,
        },
      });
    if (entry.enabled && ["failed", "connected"].includes(entry.status))
      tools.push(
        ...(before?.tools || [])
          .filter((t) => t.source === "mcp" && t.sourceServer === entry.id)
          .map((t) => ({ ...t, status: "stale" as const })),
      );
  }
  if (mcpResult.status === "rejected")
    tools.push(
      ...(before?.tools || [])
        .filter((t) => t.source === "mcp")
        .map((t) => ({ ...t, status: "stale" as const })),
    );
  const bridgeConfigured = !!runtimeEnv("MCP_BRIDGE_TOKEN");
  for (const tool of toolsList(owner))
    tools.push({
      ...descriptor(
        tool.name,
        at,
        "console-workspace",
        "workspace",
        `console-workspace.${tool.name}`,
      ),
      description: tool.description,
      toolset: "workspace",
      inputSchema: tool.inputSchema as Record<string, unknown>,
      permissions: tool.annotations.readOnlyHint ? ["read"] : ["draft"],
      readOnlyHint: tool.annotations.readOnlyHint,
      supportsParallel: tool.annotations.readOnlyHint,
      enabled: bridgeConfigured,
      status: bridgeConfigured ? "partial" : "unknown",
      metadata: {
        executionVerified: false,
        bindingSupported: true,
        reason: "工具實作存在；Hermes 橋接與執行仍須實際任務驗證。",
      },
    });
  const capabilities = online
    ? connection!.features
    : before?.capabilities || {};
  const capability = (key: string): RuntimeStatus =>
    !online
      ? "stale"
      : capabilities[key] === true
        ? "available"
        : capabilities[key] === false
          ? "unsupported"
          : "unknown";
  const skills =
    !online || connection?.discovery?.skills === "failed"
      ? before?.skills || []
      : connection!.skills;
  const toolsets = nativeFailed ? before?.toolsets || [] : connection!.toolsets;
  const profiles = listAgents()
    .filter((p) => p.role === "general" || p.status !== "unconfigured")
    .map(
      (p) =>
        ({
          id: p.id,
          name: p.name,
          displayName: p.displayName,
          description: p.description,
          role: p.role,
          enabled: p.enabled,
          status:
            p.role === "general" ? (online ? "reachable" : "failed") : p.status,
          lastVerifiedAt: p.role === "general" ? null : p.lastVerifiedAt,
          lastError:
            p.role === "general" && !online
              ? connection?.message || "探索失敗"
              : p.lastError,
          capabilities:
            p.role === "general" && connection
              ? capabilityFromHealth(connection)
              : p.capabilities,
          model:
            p.role === "general" && online
              ? connection!.models[0] || null
              : p.model,
        }) satisfies HermesRuntimeSnapshot["agents"][number],
    );
  const normalizedTools = new UnifiedToolRegistry().registerMany(tools).all();
  const snapshotBase: Omit<HermesRuntimeSnapshot, "hash" | "diagnostics"> = {
    id: "current",
    agentId: "hermes",
    profileId: "general",
    source: "hermes-runtime",
    models: online ? connection!.models : before?.models || [],
    capabilities,
    skills,
    toolsets,
    tools: normalizedTools,
    agents: profiles,
    discovery: connection?.discovery || {},
    mcpServers: entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      transport: entry.transport,
      authMode: entry.authMode,
      projectScope: "all",
      enabled: entry.enabled,
      status: mcpStatus(entry),
      serverInfo: entry.serverInfo || null,
      protocolVersion: null,
      capabilities: entry.capabilities || {},
      toolsCount: entry.tools.length,
      lastConnectedAt: entry.verifiedAt,
      lastSyncedAt: entry.verifiedAt,
      lastError: entry.lastError,
      metadata: { readonly: entry.readonly },
    })),
    sessionsSupport: capability("session_resources"),
    runsSupport: capability("run_submission"),
    memorySupport: capability("memory"),
    responsesSupport: capability("responses_api"),
    imageInputSupport: "unknown",
    status:
      !online && before
        ? "stale"
        : !online
          ? "unknown"
          : errors.length
            ? "partial"
            : connection!.status === "available"
              ? "available"
              : "partial",
    fetchedAt: at,
    lastSyncedAt: errors.length ? before?.lastSyncedAt || at : at,
    lastVerifiedAt: online ? at : before?.lastVerifiedAt || null,
    errors,
  };
  const snapshot: HermesRuntimeSnapshot = {
    ...snapshotBase,
    hash: runtimeContentHash(snapshotBase),
    diagnostics: {
      snapshotAgeMs: 0,
      lastSuccessAt: errors.length
        ? before?.diagnostics.lastSuccessAt || null
        : at,
      lastFailureAt: errors.length
        ? at
        : before?.diagnostics.lastFailureAt || null,
      durationMs: Date.now() - started,
      toolCount: normalizedTools.length,
      skillCount: skills.length,
      toolsetCount: toolsets.length,
      mcpToolCount: entries.reduce((n, entry) => n + entry.tools.length, 0),
      hermesUrlSource: credentialPresence("HERMES_API_URL").source,
      hermesKeySource: credentialPresence("HERMES_API_KEY").source,
    },
  };
  // Only the small freshness record advances per probe. No unbounded diff history.
  const changed = !before || before.hash !== snapshot.hash;
  const diff = changed ? runtimeDiff(before, snapshot) : null;
  transaction(() => {
    put("runtime_sync", owner, {
      id: "current",
      fetchedAt: at,
      lastSyncedAt: snapshot.lastSyncedAt,
      diagnostics: snapshot.diagnostics,
    });
    if (diff) {
      put("runtime_snapshot", owner, snapshot);
      put("runtime_diff", owner, { id: "current", ...diff });
    }
  });
  if (diff) {
    for (const listener of stateFor(owner).listeners) {
      try {
        listener(snapshot, diff);
      } catch {
        /* Isolate closed consumers. */
      }
    }
  }
  return snapshot;
}
function configurationIdentity() {
  // Only an in-memory hash. Never publish configuration or credential values.
  try {
    return hash(
      JSON.stringify([
        serviceIdentity(),
        runtimeEnv("MCP_BRIDGE_TOKEN"),
        configuredMcp().map((c) => [
          c,
          c.credentialReference && runtimeEnv(c.credentialReference),
        ]),
      ]),
    );
  } catch {
    return hash(serviceIdentity() + "|invalid-mcp-config");
  }
}
export async function syncRuntime(
  owner: string,
  options: { force?: boolean } = {},
): Promise<HermesRuntimeSnapshot> {
  const state = stateFor(owner),
    identity = configurationIdentity();
  if (state.inflight) return state.inflight;
  const current = runtimeSnapshot(owner);
  if (
    !options.force &&
    current &&
    state.identity === identity &&
    Date.now() < state.nextAttemptAt
  )
    return current;
  state.identity = identity;
  state.inflight = discover(owner)
    .then((snapshot) => {
      state.failures = snapshot.errors.length ? state.failures + 1 : 0;
      const delay = Math.min(
        120_000,
        RUNTIME_INTERVAL_MS * 2 ** Math.min(state.failures, 2),
      );
      state.nextAttemptAt =
        Date.now() + Math.round(delay * (0.9 + Math.random() * 0.2));
      return snapshot;
    })
    .finally(() => {
      state.inflight = undefined;
    });
  return state.inflight;
}
export function runtimeTools(
  owner: string,
  projectId?: string,
  agentId?: string,
) {
  return filterBoundTools(
    owner,
    (runtimeSnapshot(owner)?.tools || []).filter(usable),
    projectId,
    agentId,
  );
}
