import type { Task } from "@/lib/contracts";
import type { Workflow } from "@/lib/server/workflows";
import { isDirectionBriefPack, type DirectionBriefPack } from "@/lib/direction-brief";

export type SelectedDirectionContext = {
  projectId: string;
  conversationId?: string | null;
  brief?: unknown;
};

const DIRECTION_SPEC_TOOLS = new Set([
  "workspace_revise_direction_spec",
  "workspace_continue_direction_spec",
]);

function selectedIndex(letter: "A" | "B" | "C") {
  return letter === "B" ? 1 : letter === "C" ? 2 : 0;
}

function briefRevision(brief: unknown): number {
  if (!isDirectionBriefPack(brief)) return 0;
  return typeof brief.revision === "number" && Number.isFinite(brief.revision)
    ? brief.revision
    : 0;
}

function workflowStamp(item: Workflow): number {
  const value = Date.parse(item.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

/** Keep the newer spec when GET and local POST disagree. */
export function preferDirectionWorkflow(
  prior: Workflow,
  incoming: Workflow,
): Workflow {
  const priorPack = isDirectionBriefPack(prior.directionBrief)
    ? prior.directionBrief
    : null;
  const nextPack = isDirectionBriefPack(incoming.directionBrief)
    ? incoming.directionBrief
    : null;
  if (priorPack && !nextPack) return prior;
  if (!priorPack) return incoming;
  if (!nextPack) return prior;
  const priorRev = briefRevision(priorPack);
  const nextRev = briefRevision(nextPack);
  if (priorRev > nextRev) return prior;
  if (nextRev > priorRev) return incoming;
  return workflowStamp(prior) > workflowStamp(incoming) ? prior : incoming;
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

export function hasDirectionSpec(workflows: Workflow[]): boolean {
  return workflows.some((item) => isDirectionBriefPack(item.directionBrief));
}

export function readDirectionBriefFromTask(
  task: Pick<Task, "events"> | { events?: Task["events"] },
): DirectionBriefPack | null {
  const events = Array.isArray(task.events) ? task.events : [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (
      event.toolName &&
      DIRECTION_SPEC_TOOLS.has(event.toolName) &&
      isDirectionBriefPack(event.result)
    ) {
      return event.result;
    }
  }
  return null;
}

/**
 * 出圖 / 改暖 land on POST /api/tasks. Apply that pack now so the trailing
 * spec does not wait on (or get wiped by) workflows GET.
 */
export function applyDirectionBriefFromTask(
  workflows: Workflow[],
  task: Pick<Task, "conversationId" | "updatedAt" | "endedAt" | "events">,
): Workflow[] {
  const pack = readDirectionBriefFromTask(task);
  if (!pack) return workflows;
  const match =
    workflows.find(
      (item) =>
        item.conversationId === task.conversationId &&
        isDirectionBriefPack(item.directionBrief),
    ) || workflows.find((item) => isDirectionBriefPack(item.directionBrief));
  if (!match) return workflows;
  if (
    isDirectionBriefPack(match.directionBrief) &&
    briefRevision(match.directionBrief) > briefRevision(pack)
  ) {
    return workflows;
  }
  const stamp =
    (typeof task.updatedAt === "string" && task.updatedAt) ||
    (typeof task.endedAt === "string" && task.endedAt) ||
    new Date().toISOString();
  return upsertWorkflow(workflows, {
    ...match,
    brief: pack.summary,
    selected: selectedIndex(pack.selected),
    directionBrief: pack,
    copyId: typeof pack.copyId === "string" ? pack.copyId : match.copyId,
    updatedAt: stamp,
    conversationId: match.conversationId || task.conversationId,
  });
}

/**
 * A later GET must not drop a spec the student already has from select POST
 * or from a later revise/continue task.
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
    byId.set(prior.id, preferDirectionWorkflow(prior, next));
  }
  return [...byId.values()];
}
