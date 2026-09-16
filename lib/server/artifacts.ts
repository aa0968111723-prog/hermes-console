import { randomUUID } from "node:crypto";
import type { CopyDocument, CopyRevision } from "../creative";
import { get, list, put } from "./store";
import { copyDocument, selectCopy } from "./creative";
import { listMaterials } from "./materials";
import { ApiError, hash, WORKSPACE_OWNER } from "./security";

export type ArtifactSource = "copy" | "material";

export type ArtifactRevisionView = {
  revisionId: string;
  revision: number;
  title: string;
  createdAt: string;
  excerpt: string | null;
};

export type Artifact = {
  id: string;
  artifactId: string;
  revisionId: string;
  projectId: string;
  source: ArtifactSource | string;
  createdBy: string;
  createdAt: string;
  title: string;
  revision: number;
  previewUrl: string | null;
  preview?: Record<string, unknown> | null;
  expectedRevision: number;
  selectedRevision: number | null;
  excerpt: string | null;
  revisions: ArtifactRevisionView[];
  parentArtifactId?: string | null;
  workflowId?: string;
  materialId?: string;
};

function excerptOf(revision: CopyRevision) {
  const first = revision.pages[0];
  if (!first) return null;
  return (first.title + "\n" + first.body).trim().slice(0, 280);
}

function latestCopy(record: CopyDocument) {
  const selected =
    record.revisions.find((row) => row.revision === record.selectedRevision) ||
    record.revisions.at(-1);
  return selected || null;
}

function copyRevisions(record: CopyDocument): ArtifactRevisionView[] {
  return record.revisions.map((row) => ({
    revisionId: String(row.revision),
    revision: row.revision,
    title: row.title,
    createdAt: row.at,
    excerpt: excerptOf(row),
  }));
}

export function listArtifacts(owner: string, projectId?: string): Artifact[] {
  const copies: Artifact[] = [];
  for (const row of list<CopyDocument>("copy", owner)) {
    if (projectId && row.projectId !== projectId) continue;
    const revision = latestCopy(row);
    if (!revision) continue;
    copies.push({
      id: row.id,
      artifactId: row.id,
      revisionId: String(revision.revision),
      projectId: row.projectId,
      source: "copy",
      createdBy: revision.actor,
      createdAt: revision.at,
      title: revision.title,
      revision: revision.revision,
      previewUrl: null,
      expectedRevision: row.revisions.at(-1)?.revision || revision.revision,
      selectedRevision: row.selectedRevision,
      excerpt: excerptOf(revision),
      revisions: copyRevisions(row),
    });
  }
  const materials: Artifact[] = listMaterials(owner, { projectId }).map(
    (row) => ({
      id: row.id,
      artifactId: row.id,
      revisionId: "1",
      projectId: row.projectId,
      source: "material" as const,
      createdBy: "owner",
      createdAt: row.createdAt,
      title: row.title,
      revision: 1,
      previewUrl:
        row.kind === "image"
          ? "/api/materials?id=" + row.id + "&variant=thumb"
          : null,
      expectedRevision: 1,
      selectedRevision: 1,
      excerpt: null,
      revisions: [
        {
          revisionId: "1",
          revision: 1,
          title: row.title,
          createdAt: row.createdAt,
          excerpt: null,
        },
      ],
    }),
  );
  return [...copies, ...materials].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
}

export function restoreArtifact(
  owner: string,
  artifactId: string,
  revisionId: string,
  expectedRevision: number,
) {
  const record = copyDocument(owner, artifactId);
  return selectCopy(owner, record.id, expectedRevision, Number(revisionId));
}

function forkCopyDocument(
  owner: string,
  artifactId: string,
  revisionId: string | undefined,
  operationId: string,
) {
  const record = copyDocument(owner, artifactId);
  const wanted = Number(revisionId || record.selectedRevision || 0);
  const revision =
    record.revisions.find((row) => row.revision === wanted) ||
    record.revisions.at(-1);
  if (!revision)
    throw new ApiError(404, "revision_not_found", "找不到可分叉的版本。");
  const signature = hash(JSON.stringify({ artifactId, revision: revision.revision }));
  const old = get<{ id: string; signature: string; result: CopyDocument }>(
    "creative_operation",
    owner,
    operationId,
  );
  if (old) {
    if (old.signature !== signature)
      throw new ApiError(409, "operation_conflict", "操作識別已用於其他內容。");
    return old.result;
  }
  const next: CopyRevision = {
    ...revision,
    revision: 1,
    at: new Date().toISOString(),
    actor: "owner",
  };
  const created = put("copy", owner, {
    id: randomUUID(),
    projectId: record.projectId,
    activityId: record.activityId,
    selectedRevision: 1,
    revisions: [next],
  } satisfies CopyDocument);
  put("creative_operation", owner, {
    id: operationId,
    signature,
    result: created,
  });
  return created;
}


const DESIGN_KIND = "artifact";

export function listRevisions(artifactId: string, owner = WORKSPACE_OWNER) {
  return list<Artifact>(DESIGN_KIND, owner)
    .filter((item) => item.artifactId === artifactId)
    .sort((a, b) => a.revision - b.revision);
}

export function recordArtifact(input: {
  artifactId?: string;
  projectId: string;
  source: string;
  createdBy?: string;
  workflowId?: string;
  materialId?: string;
  title: string;
  parentArtifactId?: string | null;
  preview?: Record<string, unknown> | null;
}): Artifact {
  const family = input.artifactId ? listRevisions(input.artifactId) : [];
  const artifactId = input.artifactId || randomUUID();
  const revision = (family.at(-1)?.revision || 0) + 1;
  const row: Artifact = {
    id: randomUUID(),
    artifactId,
    revisionId: "v" + revision,
    revision,
    projectId: input.projectId,
    source: input.source,
    createdBy: input.createdBy || "hermes",
    createdAt: new Date().toISOString(),
    parentArtifactId: input.parentArtifactId || family.at(-1)?.id || null,
    workflowId: input.workflowId,
    materialId: input.materialId,
    title: input.title,
    preview: input.preview || null,
    previewUrl: null,
    expectedRevision: revision,
    selectedRevision: revision,
    excerpt: null,
    revisions: [],
  };
  return put(DESIGN_KIND, WORKSPACE_OWNER, row);
}

export function restoreRevision(revisionRowId: string) {
  const current = get<Artifact>(DESIGN_KIND, WORKSPACE_OWNER, revisionRowId);
  if (!current) throw new ApiError(404, "not_found", "找不到作品版本。");
  const restored = recordArtifact({
    artifactId: current.artifactId,
    projectId: current.projectId,
    source: String(current.source),
    createdBy: current.createdBy,
    workflowId: current.workflowId,
    materialId: current.materialId,
    title: current.title,
    parentArtifactId: current.id,
    preview: current.preview || null,
  });
  if (current.workflowId && current.preview) {
    const workflow = get<{
      id: string;
      design?: Record<string, unknown> | null;
      updatedAt?: string;
    }>("workflow", WORKSPACE_OWNER, current.workflowId);
    if (workflow)
      put("workflow", WORKSPACE_OWNER, {
        ...workflow,
        design: current.preview,
        updatedAt: new Date().toISOString(),
      });
  }
  return restored;
}

function forkDesignRevision(revisionRowId: string) {
  const current = get<Artifact>(DESIGN_KIND, WORKSPACE_OWNER, revisionRowId);
  if (!current) throw new ApiError(404, "not_found", "找不到作品版本。");
  return recordArtifact({
    projectId: current.projectId,
    source: String(current.source),
    createdBy: current.createdBy,
    workflowId: current.workflowId,
    materialId: current.materialId,
    title: current.title + "（副本）",
    parentArtifactId: current.id,
    preview: current.preview || null,
  });
}

export function forkArtifact(revisionRowId: string): Artifact;
export function forkArtifact(
  owner: string,
  artifactId: string,
  revisionId: string | undefined,
  operationId: string,
): CopyDocument;
export function forkArtifact(
  ownerOrId: string,
  artifactId?: string,
  revisionId?: string,
  operationId?: string,
): Artifact | CopyDocument {
  if (artifactId === undefined) return forkDesignRevision(ownerOrId);
  return forkCopyDocument(ownerOrId, artifactId, revisionId, operationId!);
}
