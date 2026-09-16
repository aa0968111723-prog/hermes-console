import type { Workflow } from "@/lib/server/workflows";
import { isDirectionBriefPack } from "@/lib/direction-brief";

export type SelectedDirectionContext = {
  projectId: string;
  conversationId?: string | null;
  brief?: unknown;
};

function selectedIndex(letter: "A" | "B" | "C") {
  return letter === "B" ? 1 : letter === "C" ? 2 : 0;
}

/** Turn a select POST body into a chat-ready workflow. */
export function readSelectedDirectionWorkflow(
  value: unknown,
  context: SelectedDirectionContext,
): Workflow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<Workflow>;
  if (typeof row.id !== "string" || !row.id) return null;
  const pack = isDirectionBriefPack(row.directionBrief)
    ? row.directionBrief
    : isDirectionBriefPack(context.brief)
      ? context.brief
      : null;
  if (!pack) return null;
  const projectId =
    typeof row.projectId === "string" && row.projectId
      ? row.projectId
      : context.projectId;
  if (!projectId) return null;
  const conversationId =
    typeof row.conversationId === "string"
      ? row.conversationId
      : context.conversationId || null;
  const stamp =
    typeof row.updatedAt === "string" && row.updatedAt
      ? row.updatedAt
      : new Date().toISOString();
  return {
    id: row.id,
    projectId,
    activityId: row.activityId,
    brief: typeof row.brief === "string" ? row.brief : pack.summary,
    directions: Array.isArray(row.directions) ? row.directions : [],
    selected:
      typeof row.selected === "number" ? row.selected : selectedIndex(pack.selected),
    state: row.state || "draft_ready",
    createdAt:
      typeof row.createdAt === "string" && row.createdAt ? row.createdAt : stamp,
    updatedAt: stamp,
    canvaJobId: row.canvaJobId ?? null,
    design: row.design && typeof row.design === "object" ? row.design : null,
    artifactId: row.artifactId,
    revisionId: row.revisionId,
    error: typeof row.error === "string" ? row.error : null,
    directionBrief: pack,
    copyId: typeof row.copyId === "string" ? row.copyId : pack.copyId,
    conversationId,
  };
}

export function upsertWorkflow(
  workflows: Workflow[],
  workflow: Workflow,
): Workflow[] {
  return [workflow, ...workflows.filter((item) => item.id !== workflow.id)];
}

/**
 * A later GET must not drop a spec the student already has from select POST.
 */
export function mergeWorkflows(
  previous: Workflow[],
  incoming: unknown,
): Workflow[] {
  if (!Array.isArray(incoming)) return previous;
  const list = incoming.filter(
    (item): item is Workflow =>
      !!item &&
      typeof item === "object" &&
      typeof (item as Workflow).id === "string",
  );
  if (!list.length && previous.length) return previous;
  const byId = new Map(list.map((item) => [item.id, item]));
  for (const prior of previous) {
    const next = byId.get(prior.id);
    if (!next) {
      if (isDirectionBriefPack(prior.directionBrief)) byId.set(prior.id, prior);
      continue;
    }
    if (
      isDirectionBriefPack(prior.directionBrief) &&
      !isDirectionBriefPack(next.directionBrief)
    ) {
      byId.set(prior.id, prior);
    }
  }
  return [...byId.values()];
}
