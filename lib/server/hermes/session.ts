/**
 * Hermes Session 隔離與上下文管理
 * 支援以 X-Hermes-Session-Key 進行專案隔離（例如 project:tku-zen, campaign:2026-tea-party）
 */

export interface SessionContext {
  sessionKey: string;
  activeProject: string;
  currentProfileId: string;
  createdAt: number;
  lastActiveAt: number;
  metadata: Record<string, unknown>;
}

export interface SessionConversation {
  id: string;
  sessionKey: string;
  createdAt: number;
}

const sessionStore = new Map<string, SessionContext>();
const conversationStore = new Map<string, SessionConversation>();

const STRUCTURED_KEY = /^(workspace|project:[a-z0-9_-]+|campaign:[a-z0-9_-]+|audience:[a-z0-9_-]+)$/;

/**
 * 標準化會話識別鍵。
 * Conversation ID 與 Session Key 分離：同 project 可開新對話、沿用同一把 key。
 */
export function normalizeSessionKey(
  raw?: string,
  context?: { projectId?: string; campaignId?: string; audienceId?: string },
): string {
  const trimmed = String(raw || "").trim().toLowerCase();
  if (trimmed) {
    const cleaned = trimmed.replace(/[^a-z0-9:_-]/g, "");
    if (STRUCTURED_KEY.test(cleaned) || cleaned.includes(":")) return cleaned;
    return cleaned;
  }
  if (context?.audienceId) {
    return `audience:${context.audienceId.toLowerCase().replace(/[^a-z0-9_-]/g, "")}`;
  }
  if (context?.campaignId) {
    return `campaign:${context.campaignId.toLowerCase().replace(/[^a-z0-9_-]/g, "")}`;
  }
  if (context?.projectId && context.projectId !== "personal") {
    return `project:${context.projectId.toLowerCase().replace(/[^a-z0-9_-]/g, "")}`;
  }
  return "workspace";
}

/**
 * 取得或建立會話上下文
 */
export function getOrCreateSessionContext(
  rawKey?: string,
  defaults?: { activeProject?: string; profileId?: string }
): SessionContext {
  const sessionKey = normalizeSessionKey(rawKey);
  const existing = sessionStore.get(sessionKey);

  if (existing) {
    existing.lastActiveAt = Date.now();
    if (defaults?.activeProject) existing.activeProject = defaults.activeProject;
    if (defaults?.profileId) existing.currentProfileId = defaults.profileId;
    return existing;
  }

  const newContext: SessionContext = {
    sessionKey,
    activeProject: defaults?.activeProject || "tku-zen-agent",
    currentProfileId: defaults?.profileId || "tku",
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    metadata: {}
  };

  sessionStore.set(sessionKey, newContext);
  return newContext;
}

export function getSessionContext(rawKey: string): SessionContext | undefined {
  return sessionStore.get(normalizeSessionKey(rawKey));
}

export function createConversation(rawKey?: string): SessionConversation {
  const sessionKey = normalizeSessionKey(rawKey);
  getOrCreateSessionContext(sessionKey);
  const record: SessionConversation = {
    id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionKey,
    createdAt: Date.now(),
  };
  conversationStore.set(record.id, record);
  return record;
}

export function listConversationsForSession(rawKey: string): SessionConversation[] {
  const sessionKey = normalizeSessionKey(rawKey);
  return Array.from(conversationStore.values()).filter((item) => item.sessionKey === sessionKey);
}

export function conversationBelongsToSession(conversationId: string, rawKey: string) {
  const record = conversationStore.get(conversationId);
  return Boolean(record && record.sessionKey === normalizeSessionKey(rawKey));
}

/**
 * 更新會話元資料
 */
export function updateSessionMetadata(sessionKey: string, key: string, value: unknown) {
  const ctx = sessionStore.get(normalizeSessionKey(sessionKey));
  if (ctx) {
    ctx.metadata[key] = value;
    ctx.lastActiveAt = Date.now();
  }
}
