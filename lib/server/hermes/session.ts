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

const sessionStore = new Map<string, SessionContext>();

/**
 * 標準化會話識別鍵
 */
export function normalizeSessionKey(raw?: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return "workspace:default";
  }
  // 保持簡潔規格
  return trimmed.toLowerCase().replace(/[^a-z0-9:_-]/g, "");
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
