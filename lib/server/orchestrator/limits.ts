export const TASK_LIMITS = {
  maxDepth: 2,
  maxResearchSources: 30,
  maxAudienceRoles: 5,
  maxCreativeDirections: 5,
  maxRevisions: 3,
} as const;

export function clampTaskList<T>(items: T[], max: number): T[] {
  return items.slice(0, Math.max(0, max));
}
