import { randomUUID } from "node:crypto";
import { z } from "zod";
import { projectKey } from "../creative";
import { ApiError, redact } from "./security";
import { get, list, put, remove } from "./store";
import type { Health } from "../contracts";

export const memoryKinds = {
  fact: "事實",
  note: "筆記",
  preference: "偏好",
  scope: "範圍備註",
} as const;

export const memoryInput = z
  .object({
    id: z.string().uuid().optional(),
    scope: projectKey.or(z.literal("workspace")).default("workspace"),
    kind: z.enum(["fact", "note", "preference", "scope"]),
    title: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(2000),
    tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
    expectedRevision: z.number().int().min(0).optional(),
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
};

const KIND = "shared_memory";
const SECRETISH =
  /(API[_-]?KEY|TOKEN|PASSWORD|SECRET|AUTHORIZATION|BEARER)\s*[:=]/i;

function rejectSecrets(value: unknown) {
  const text = JSON.stringify(value);
  if (redact(text) !== text || SECRETISH.test(text))
    throw new ApiError(400, "sensitive_content", "共用記憶不得包含憑證或金鑰。");
}

export function getMemory(owner: string, id: string) {
  const item = get<SharedMemory>(KIND, owner, id);
  if (!item) throw new ApiError(404, "memory_not_found", "找不到這筆共用記憶。");
  return item;
}

export function listMemories(owner: string, scope?: string) {
  return list<SharedMemory>(KIND, owner).filter((item) => {
    if (!scope || scope === "all") return true;
    return item.scope === scope || item.scope === "workspace";
  });
}

export function saveMemory(
  owner: string,
  raw: z.input<typeof memoryInput>,
): SharedMemory {
  const input = memoryInput.parse(raw);
  if (input.scope !== "workspace" && input.scope !== "personal" && !get("project", owner, input.scope))
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
  return put(KIND, owner, {
    id: previous?.id || randomUUID(),
    scope: input.scope,
    kind: input.kind,
    title: input.title,
    content: input.content,
    tags: input.tags,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    revision: (previous?.revision || 0) + 1,
  } satisfies SharedMemory);
}

export function deleteMemory(owner: string, id: string) {
  getMemory(owner, id);
  if (!remove(KIND, owner, id))
    throw new ApiError(404, "memory_not_found", "找不到這筆共用記憶。");
  return { deleted: true as const, id };
}

export function memoryDigest(owner: string, projectId?: string) {
  const items = listMemories(owner, projectId || "workspace").slice(0, 8);
  if (!items.length) return "";
  const lines = items.map((item) => {
    const body = item.content.replace(/\s+/g, " ").slice(0, 200);
    return `- [${item.kind}/${item.scope}] ${item.title}：${body}`;
  });
  return (
    "\n工作區共用記憶（Console SQLite，經 Workspace MCP 與任務指示共用；不是 Hermes 遠端記憶鏡像）：\n" +
    lines.join("\n")
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
  return {
    store: "console-sqlite" as const,
    sharedVia: ["workspace-mcp", "task-instructions"] as const,
    hermesRemote,
    scopeVerified,
    count: listMemories(owner).length,
    synced: false,
    notice:
      hermesRemote === "available"
        ? "Console SQLite 是共用來源；Hermes 遠端記憶能力已宣告且管理者聲明範圍已驗證，仍不代表雙方已雙向鏡像。"
        : "Console SQLite 是 Hermes 可讀寫的共用來源（Workspace MCP 與任務指示）。尚未驗證 Hermes 遠端記憶同步，不會宣稱已對齊。",
  };
}
