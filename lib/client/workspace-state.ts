import type { Conversation, Material, Message, Task } from "@/lib/contracts";
import { taskHasWorkspaceResult } from "@/lib/client/activity";

/** Student-safe copy for a failed workspace GET. Never include secrets or internals. */
export const WORKSPACE_LOAD_NOTICE =
  "工作區讀取失敗。請重新載入頁面；連線未確認時仍可使用此工作區。";

const SECRETISH =
  /HERMES_API|Bearer\s|sk-[a-zA-Z0-9_-]{8,}|postgres(?:ql)?:\/\/|vault\.key|環境變數|CONSOLE_GATEWAY|x-console-gateway/i;

export type WorkspaceSnapshot = {
  conversations: Conversation[];
  projects: Array<{ id: string; name: string }>;
  materials: Material[];
  imageInput: boolean;
  memory: { status: string; scope: string; synced: boolean };
};

export const EMPTY_WORKSPACE: WorkspaceSnapshot = {
  conversations: [],
  projects: [],
  materials: [],
  imageInput: false,
  memory: {
    status: "unsupported",
    scope: "尚未同步 Hermes 記憶。",
    synced: false,
  },
};

export function isAbortLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

export function studentSafeApiMessage(
  message: string,
  fallback = WORKSPACE_LOAD_NOTICE,
) {
  if (!message.trim() || SECRETISH.test(message)) return fallback;
  return message;
}

function asConversation(value: unknown): Conversation | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Conversation>;
  if (typeof row.id !== "string" || !row.id) return null;
  return {
    ...(row as Conversation),
    id: row.id,
    title: typeof row.title === "string" ? row.title : "",
    projectId: typeof row.projectId === "string" ? row.projectId : "personal",
    messages: Array.isArray(row.messages) ? row.messages : [],
    hermesSessionId:
      typeof row.hermesSessionId === "string" || row.hermesSessionId === null
        ? row.hermesSessionId
        : null,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
  };
}

/** Reject 200 bodies that would crash render (`data.conversations.find`). */
export function readWorkspaceSnapshot(value: unknown): WorkspaceSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !Array.isArray(row.conversations) ||
    !Array.isArray(row.projects) ||
    !Array.isArray(row.materials)
  )
    return null;
  const conversations = row.conversations
    .map(asConversation)
    .filter((item): item is Conversation => !!item);
  const projects = row.projects.filter(
    (item): item is { id: string; name: string } =>
      !!item &&
      typeof item === "object" &&
      typeof (item as { id?: unknown }).id === "string" &&
      typeof (item as { name?: unknown }).name === "string",
  );
  const memory =
    row.memory && typeof row.memory === "object"
      ? {
          status: String(
            (row.memory as { status?: unknown }).status || "unsupported",
          ),
          scope: String(
            (row.memory as { scope?: unknown }).scope ||
              "尚未同步 Hermes 記憶。",
          ),
          synced: !!(row.memory as { synced?: unknown }).synced,
        }
      : EMPTY_WORKSPACE.memory;
  return {
    conversations,
    projects,
    materials: row.materials as Material[],
    imageInput: row.imageInput === true,
    memory,
  };
}

/**
 * A later GET must not drop the open thread. Keep local conversations the
 * server omitted or returned with fewer messages (stale poll vs in-flight send).
 */
export function mergeWorkspaceSnapshot(
  previous: WorkspaceSnapshot,
  incoming: WorkspaceSnapshot,
): WorkspaceSnapshot {
  const byId = new Map(
    incoming.conversations.map((conversation) => [
      conversation.id,
      conversation,
    ]),
  );
  for (const conversation of previous.conversations) {
    const next = byId.get(conversation.id);
    if (!next) {
      byId.set(conversation.id, conversation);
      continue;
    }
    const nextCount = next.messages?.length || 0;
    const previousCount = conversation.messages?.length || 0;
    if (previousCount > nextCount) byId.set(conversation.id, conversation);
  }
  return {
    ...incoming,
    conversations: [...byId.values()],
    projects: incoming.projects.length ? incoming.projects : previous.projects,
    materials: incoming.materials.length
      ? incoming.materials
      : previous.materials,
    memory: incoming.memory || previous.memory,
  };
}

export function mergeTasks(previous: Task[], incoming: unknown): Task[] {
  if (!Array.isArray(incoming)) return previous;
  const list = incoming.filter(
    (item): item is Task =>
      !!item &&
      typeof item === "object" &&
      typeof (item as Task).id === "string",
  );
  if (!list.length && previous.length) return previous;
  const byId = new Map(
    list.map((task) => [
      task.id,
      { ...task, events: Array.isArray(task.events) ? task.events : [] },
    ]),
  );
  for (const task of previous) {
    const next = byId.get(task.id);
    if (!next) {
      byId.set(task.id, task);
      continue;
    }
    const previousEvents = Array.isArray(task.events) ? task.events.length : 0;
    const nextEvents = Array.isArray(next.events) ? next.events.length : 0;
    if (previousEvents > nextEvents) byId.set(task.id, task);
  }
  return [...byId.values()];
}

/** Keep the thread visible even if the follow-up workspace GET fails. */
export function conversationWithTaskMessages(
  conversation: Conversation,
  task: Task,
  attachments: string[] = [],
): Conversation {
  const messages = [...(conversation.messages || [])];
  if (!messages.some((item) => item.taskId === task.id && item.role === "user")) {
    messages.push({
      id: "local-user-" + task.id,
      role: "user",
      content: task.input,
      createdAt: task.createdAt,
      attachments,
      taskId: task.id,
    });
  }
  const terminal = [
    "completed",
    "failed",
    "uncertain",
    "cancelled",
  ].includes(task.state);
  if (
    terminal &&
    task.output &&
    !messages.some((item) => item.taskId === task.id && item.role === "assistant")
  ) {
    const provenance: Message["provenance"] = taskHasWorkspaceResult(task)
      ? "workspace"
      : "hermes";
    messages.push({
      id: "local-assistant-" + task.id,
      role: "assistant",
      content: task.output,
      createdAt: task.endedAt || task.updatedAt || task.createdAt,
      taskId: task.id,
      provenance,
    });
  }
  return {
    ...conversation,
    messages,
    updatedAt: task.updatedAt || conversation.updatedAt,
  };
}

export function upsertConversation(
  conversations: Conversation[],
  conversation: Conversation,
): Conversation[] {
  const rest = conversations.filter((item) => item.id !== conversation.id);
  return [conversation, ...rest];
}
