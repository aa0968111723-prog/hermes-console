import { randomUUID } from "node:crypto";
import { z } from "zod";
import { projectKey } from "../creative";
import { ApiError, redact } from "./security";
import { get, list, put, remove, storeBackend, probeStore } from "./store";
import { researchDigest } from "./research-index";
import type { Health } from "../contracts";

export const memoryKinds = {
  fact: "事實",
  note: "筆記",
  preference: "偏好",
  scope: "範圍備註",
} as const;

export const memorySources = [
  "console",
  "workspace-mcp",
  "import",
  "operator",
] as const;

export const memoryInput = z
  .object({
    id: z.string().uuid().optional(),
    scope: projectKey.or(z.literal("workspace")).default("workspace"),
    kind: z.enum(["fact", "note", "preference", "scope"]),
    title: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(2000),
    tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
    expectedRevision: z.number().int().min(0).optional(),
    // Provenance (same store row; not a second store or Hermes remote mirror)
    source: z.enum(memorySources).optional(),
    createdBy: z.string().trim().min(1).max(80).optional(),
    importance: z.number().min(0).max(1).nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    layer: z
      .enum(["conversation", "project", "workspace", "preference", "runtime"])
      .optional(),
    conversationId: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export type SharedMemory = {
  id: string;
  scope: string;
  kind: keyof typeof memoryKinds;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  revision: number;
  /** Where the row was written from (console UI, MCP, import, operator). */
  source: (typeof memorySources)[number];
  /** Logical actor label; not an account login. */
  createdBy: string;
  /** 0–1 operator importance, or null if unset. */
  importance: number | null;
  /** Last time included in a task digest or explicit read; null until used. */
  lastUsedAt: string | null;
  /** 0–1 confidence in the content, or null if unset. */
  confidence: number | null;
  layer: "conversation" | "project" | "workspace" | "preference" | "runtime";
  conversationId: string | null;
};

const KIND = "shared_memory";
const SECRETISH =
  /(API[_-]?KEY|TOKEN|PASSWORD|SECRET|AUTHORIZATION|BEARER)\s*[:=]/i;

function storeOp<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "store_unavailable", "儲存庫無法使用。");
  }
}

function rejectSecrets(value: unknown) {
  const text = JSON.stringify(value);
  if (redact(text) !== text || SECRETISH.test(text))
    throw new ApiError(400, "sensitive_content", "共用記憶不得包含憑證或金鑰。");
}

export const STALE_MEMORY_DAYS = 30;

export function inferMemoryLayer(
  kind: SharedMemory["kind"],
  scope: string,
  conversationId?: string | null,
): SharedMemory["layer"] {
  if (kind === "preference") return "preference";
  if (conversationId) return "conversation";
  if (scope === "workspace") return "workspace";
  return "project";
}

export function memoryAgeDays(item: SharedMemory, now = Date.now()) {
  const age = now - Date.parse(item.updatedAt);
  if (!Number.isFinite(age) || age < 0) return Number.POSITIVE_INFINITY;
  return age / 86_400_000;
}

export function isStaleMemory(item: SharedMemory, now = Date.now()) {
  return memoryAgeDays(item, now) >= STALE_MEMORY_DAYS;
}

function normalizeMemory(raw: SharedMemory): SharedMemory {
  const conversationId = raw.conversationId || null;
  return {
    ...raw,
    source: raw.source || "console",
    createdBy: raw.createdBy || "workspace",
    importance:
      typeof raw.importance === "number" && Number.isFinite(raw.importance)
        ? Math.min(1, Math.max(0, raw.importance))
        : null,
    lastUsedAt: raw.lastUsedAt || null,
    confidence:
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.min(1, Math.max(0, raw.confidence))
        : null,
    conversationId,
    layer:
      raw.layer || inferMemoryLayer(raw.kind, raw.scope, conversationId),
  };
}

export function getMemory(owner: string, id: string) {
  const item = storeOp(() => get<SharedMemory>(KIND, owner, id));
  if (!item) throw new ApiError(404, "memory_not_found", "找不到這筆共用記憶。");
  return normalizeMemory(item);
}

export function listMemories(owner: string, scope?: string) {
  return storeOp(() => list<SharedMemory>(KIND, owner))
    .map(normalizeMemory)
    .filter((item) => {
      if (!scope || scope === "all") return true;
      return item.scope === scope || item.scope === "workspace";
    });
}

/** Memories Hermes may use as task context. Runtime state stays out; conversation rows stay in their thread. */
export function memoriesForContext(
  owner: string,
  projectId?: string,
  options?: { conversationId?: string | null },
) {
  return listMemories(owner, projectId || "workspace").filter((item) => {
    if (item.layer === "runtime") return false;
    if (item.layer === "conversation") {
      if (!options?.conversationId || !item.conversationId) return false;
      return item.conversationId === options.conversationId;
    }
    return true;
  });
}

export function saveMemory(
  owner: string,
  raw: z.input<typeof memoryInput>,
): SharedMemory {
  const input = memoryInput.parse(raw);
  if (
    input.scope !== "workspace" &&
    input.scope !== "personal" &&
    !storeOp(() => get("project", owner, input.scope))
  )
    throw new ApiError(404, "project_not_found", "專案不存在。");
  rejectSecrets(input);
  const previous = input.id ? getMemory(owner, input.id) : null;
  if (previous && previous.scope !== input.scope)
    throw new ApiError(403, "memory_scope", "不能把記憶移到其他範圍。");
  if (
    previous &&
    input.expectedRevision !== undefined &&
    previous.revision !== input.expectedRevision
  )
    throw new ApiError(409, "revision_conflict", "記憶已被更新，請重新讀取後修改。");
  const now = new Date().toISOString();
  const conversationId =
    input.conversationId || previous?.conversationId || null;
  return storeOp(() =>
    put(KIND, owner, {
      id: previous?.id || randomUUID(),
      scope: input.scope,
      kind: input.kind,
      title: input.title,
      content: input.content,
      tags: input.tags,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      revision: (previous?.revision || 0) + 1,
      source: input.source || previous?.source || "console",
      createdBy: input.createdBy || previous?.createdBy || "workspace",
      importance:
        input.importance !== undefined
          ? input.importance
          : (previous?.importance ?? null),
      lastUsedAt: previous?.lastUsedAt ?? null,
      confidence:
        input.confidence !== undefined
          ? input.confidence
          : (previous?.confidence ?? null),
      conversationId,
      layer:
        input.layer ||
        previous?.layer ||
        inferMemoryLayer(input.kind, input.scope, conversationId),
    } satisfies SharedMemory),
  );
}

export function deleteMemory(owner: string, id: string) {
  getMemory(owner, id);
  if (!storeOp(() => remove(KIND, owner, id)))
    throw new ApiError(404, "memory_not_found", "找不到這筆共用記憶。");
  return { deleted: true as const, id };
}

/** Mark memories as used when they enter a task digest (same row, no second store). */
export function touchMemories(owner: string, ids: string[]) {
  const now = new Date().toISOString();
  for (const id of ids) {
    const item = get<SharedMemory>(KIND, owner, id);
    if (!item) continue;
    put(KIND, owner, {
      ...normalizeMemory(item),
      lastUsedAt: now,
    });
  }
}


export type MemoryEvidenceKind = "LOCAL" | "LIVE_EXTERNAL";

/** Console store evidence: sqlite = LOCAL, postgres = LIVE_EXTERNAL (same store, no second DB). */
export function memoryEvidenceKind(): MemoryEvidenceKind {
  return storeBackend() === "postgres" ? "LIVE_EXTERNAL" : "LOCAL";
}

export function memoryWriteApiEnabled() {
  return probeStore().ok;
}

export type MemoryWriteProof = {
  memory: SharedMemory;
  readBack: SharedMemory;
  evidence: {
    kind: MemoryEvidenceKind;
    store: ReturnType<typeof memoryStoreId>;
    readBackOk: true;
    operation: "write";
  };
};

/** Persist then read the same row back from the same store (LIVE proof). */
export function writeMemoryWithReadBack(
  owner: string,
  raw: z.input<typeof memoryInput>,
): MemoryWriteProof {
  const memory = saveMemory(owner, raw);
  const readBack = getMemory(owner, memory.id);
  if (readBack.id !== memory.id || readBack.revision !== memory.revision)
    throw new ApiError(
      500,
      "memory_readback_mismatch",
      "寫入後讀回不一致，不當作成功。",
    );
  return {
    memory,
    readBack,
    evidence: {
      kind: memoryEvidenceKind(),
      store: memoryStoreId(),
      readBackOk: true,
      operation: "write",
    },
  };
}

export function memoryStoreId() {
  return storeBackend() === "postgres"
    ? ("console-postgres" as const)
    : ("console-sqlite" as const);
}

function memoryStoreLabel() {
  return storeBackend() === "postgres" ? "Console Postgres" : "Console SQLite";
}

export function memoryDigest(
  owner: string,
  projectId?: string,
  conversationId?: string,
) {
  const items = memoriesForContext(owner, projectId || "workspace", {
    conversationId,
  })
    .sort((a, b) => {
      const staleA = isStaleMemory(a) ? 1 : 0;
      const staleB = isStaleMemory(b) ? 1 : 0;
      if (staleA !== staleB) return staleA - staleB;
      const impA = a.importance ?? 0;
      const impB = b.importance ?? 0;
      if (impA !== impB) return impB - impA;
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, 8);
  if (!items.length) return "";
  touchMemories(
    owner,
    items.map((item) => item.id),
  );
  const lines = items.map((item) => {
    const body = item.content.replace(/\s+/g, " ").slice(0, 200);
    const meta: string[] = [
      `${item.kind}/${item.scope}`,
      `layer=${item.layer}`,
    ];
    if (item.source !== "console") meta.push(`src=${item.source}`);
    if (item.confidence != null)
      meta.push(`conf=${item.confidence.toFixed(2)}`);
    if (item.importance != null)
      meta.push(`imp=${item.importance.toFixed(2)}`);
    if (isStaleMemory(item)) meta.push("stale");
    return `- [${meta.join(" ")}] ${item.title}：${body}`;
  });
  return (
    "\n工作區共用記憶（" +
    memoryStoreLabel() +
    "，經 Workspace MCP 與任務指示共用；不是 Hermes 遠端記憶鏡像）：\n" +
    lines.join("\n") +
    researchDigest(6)
  );
}

export function memoryShareStatus(owner: string, connection?: Health) {
  const scopeVerified = process.env.HERMES_LEARNING_SCOPE_VERIFIED === "true";
  const remoteFlag = connection?.features?.memory;
  const hermesRemote =
    remoteFlag === true
      ? scopeVerified
        ? "available"
        : "unverified"
      : remoteFlag === false || connection?.status === "failed"
        ? "unsupported"
        : "unknown";
  const writeApi = memoryWriteApiEnabled();
  return {
    store: memoryStoreId(),
    sharedVia: ["workspace-mcp", "task-instructions"] as const,
    hermesRemote,
    scopeVerified,
    count: listMemories(owner).length,
    synced: false,
    memory_write_api: writeApi,
    evidence: {
      kind: memoryEvidenceKind(),
      store: memoryStoreId(),
      operation: "status" as const,
    },
    provenanceFields: [
      "source",
      "createdBy",
      "importance",
      "lastUsedAt",
      "confidence",
      "layer",
      "createdAt",
      "updatedAt",
      "scope",
    ] as const,
    notice:
      hermesRemote === "available"
        ? "這是工作區共用記憶。Hermes 已支援記憶，但不代表兩邊已經同步。"
        : "這是工作區共用記憶。尚未確認遠端同步，不會宣稱已對齊。",
  };
}
