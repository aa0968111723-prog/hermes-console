/** Workspace poll cadence. Active tasks stay near-real-time; idle and hidden tabs back off. */
export const ACTIVE_POLL_MS = 3_000;
export const IDLE_POLL_MS = 12_000;
export const HIDDEN_POLL_MS = 30_000;

export function workspacePollDelay(hidden: boolean, hasActiveTask: boolean) {
  if (hidden) return HIDDEN_POLL_MS;
  if (hasActiveTask) return ACTIVE_POLL_MS;
  return IDLE_POLL_MS;
}
