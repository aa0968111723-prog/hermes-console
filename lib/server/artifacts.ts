import { randomUUID } from "node:crypto";
import type { CopyDocument, CopyRevision } from "../creative";
import { copyDocument, selectCopy } from "./creative";
import { listMaterials } from "./materials";
import { ApiError, hash, redact } from "./security";
import { get, list, put, transaction } from "./store";

const KIND = "artifact";

export type ArtifactRevision = {
  revisionId: string;
  revision: number;
  createdAt: string;
  createdBy: string;
  source: string;
  design: Record<string, unknown>;
  title?: string;
  excerpt?: string | null;
};

export type Artifact = {
  id: string;
  artifactId: string;
  projectId: string;
  workflowId: string | null;
  source: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  currentRevisionId: string;
  revision?: number;
  expectedRevision?: number;
  selectedRevision?: number | null;
  title?: string;
  previewUrl?: string | null;
  excerpt?: string | null;
  revisions: ArtifactRevision[];
};

function sanitizeDesign(design: Record<string, unknown>) {
  return JSON.parse(redact(JSON.stringify(design))) as Record<string, unknown>;
}

function currentRevision(artifact: Artifact) {
  return (
    artifact.revisions.find(
      (item) => item.revisionId === artifact.currentRevisionId,
    ) || artifact.revisions.at(-1)
  );
}

function getDesignArtifact(owner: string, id: string) {
  const artifact = get<Artifact>(KIND, owner, id);
  if (!artifact)
    throw new ApiError(404, "artifact_not_found", "找不到這個作品。");
  return artifact;
}

function syncWorkflowDesign(owner: string, artifact: Artifact) {
  if (!artifact.workflowId) return;
  const record = get<{
    id: string;
    design: Record<string, unknown> | null;
    artifactId?: string | null;
    revisionId?: string | null;
    updatedAt: string;
  }>("workflow", owner, artifact.workflowId);
  if (!record) return;
  const revision = currentRevision(artifact);
  if (!revision) return;
  put("workflow", owner, {
    ...record,
    design: revision.design,
    artifactId: artifact.id,
    revisionId: artifact.currentRevisionId,
    updatedAt: artifact.updatedAt,
  });
}

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

function asCopyArtifact(record: CopyDocument): Artifact | null {
  const revision = latestCopy(record);
  if (!revision) return null;
  return {
    id: record.id,
    artifactId: record.id,
    projectId: record.projectId,
    workflowId: null,
    source: "copy",
    createdBy: revision.actor,
    createdAt: revision.at,
    updatedAt: revision.at,
    currentRevisionId: String(record.selectedRevision || revision.revision),
    revision: revision.revision,
    expectedRevision: record.revisions.at(-1)?.revision || revision.revision,
    selectedRevision: record.selectedRevision,
    title: revision.title,
    previewUrl: null,
    excerpt: excerptOf(revision),
    revisions: record.revisions.map((row) => ({
      revisionId: String(row.revision),
      revision: row.revision,
      createdAt: row.at,
      createdBy: row.actor,
      source: "copy",
      design: {
        title: row.title,
        body: row.pages[0]?.body || "",
      },
      title: row.title,
      excerpt: excerptOf(row),
    })),
  };
}

function asMaterialArtifact(row: {
  id: string;
  projectId: string;
  title: string;
  kind: string;
  createdAt: string;
}): Artifact {
  return {
    id: row.id,
    artifactId: row.id,
    projectId: row.projectId,
    workflowId: null,
    source: "material",
    createdBy: "owner",
    createdAt: row.createdAt,
    updatedAt: row.createdAt,
    currentRevisionId: "1",
    revision: 1,
    expectedRevision: 1,
    selectedRevision: 1,
    title: row.title,
    previewUrl:
      row.kind === "image"
        ? "/api/materials?id=" + row.id + "&variant=thumb"
        : null,
    excerpt: null,
    revisions: [
      {
        revisionId: "1",
        revision: 1,
        createdAt: row.createdAt,
        createdBy: "owner",
        source: "material",
        design: { title: row.title },
        title: row.title,
        excerpt: null,
      },
    ],
  };
}

function withIds(artifact: Artifact): Artifact {
  return {
    ...artifact,
    artifactId: artifact.artifactId || artifact.id,
    id: artifact.id || artifact.artifactId,
  };
}

export function listDesignArtifacts(owner: string, projectId?: string) {
  return list<Artifact>(KIND, owner)
    .map(withIds)
    .filter((item) => !projectId || item.projectId === projectId);
}

export function listArtifacts(owner: string, projectId?: string): Artifact[] {
  const copies: Artifact[] = [];
  for (const row of list<CopyDocument>("copy", owner)) {
    if (projectId && row.projectId !== projectId) continue;
    const viewed = asCopyArtifact(row);
    if (viewed) copies.push(viewed);
  }
  const materials = listMaterials(owner, { projectId }).map(asMaterialArtifact);
  const designs = listDesignArtifacts(owner, projectId);
  return [...copies, ...materials, ...designs].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
}

export function recordDesignRevision(
  owner: string,
  input: {
    artifactId?: string;
    projectId: string;
    workflowId?: string | null;
    source?: string;
    createdBy?: string;
    design: Record<string, unknown>;
  },
): Artifact {
  return transaction(() => {
    const design = sanitizeDesign(input.design);
    const now = new Date().toISOString();
    const existing = input.artifactId
      ? get<Artifact>(KIND, owner, input.artifactId)
      : input.workflowId
        ? list<Artifact>(KIND, owner).find(
            (item) => item.workflowId === input.workflowId,
          )
        : undefined;
    const revision: ArtifactRevision = {
      revisionId: randomUUID(),
      revision: (existing?.revisions.at(-1)?.revision || 0) + 1,
      createdAt: now,
      createdBy: input.createdBy || "hermes",
      source: input.source || existing?.source || "canva",
      design,
    };
    if (existing) {
      if (existing.revisions.length >= 50)
        throw new ApiError(
          409,
          "revision_limit",
          "作品版本過多，請先分叉再修改。",
        );
      const next = withIds(
        put(KIND, owner, {
          ...existing,
          artifactId: existing.artifactId || existing.id,
          updatedAt: now,
          currentRevisionId: revision.revisionId,
          revisions: [...existing.revisions, revision],
        } satisfies Artifact),
      );
      syncWorkflowDesign(owner, next);
      return next;
    }
    const id = randomUUID();
    const created = withIds(
      put(KIND, owner, {
        id,
        artifactId: id,
        projectId: input.projectId,
        workflowId: input.workflowId || null,
        source: input.source || "canva",
        createdBy: input.createdBy || "hermes",
        createdAt: now,
        updatedAt: now,
        currentRevisionId: revision.revisionId,
        revisions: [revision],
      } satisfies Artifact),
    );
    syncWorkflowDesign(owner, created);
    return created;
  });
}

export function restoreArtifact(
  owner: string,
  artifactId: string,
  revisionId: string,
): Artifact;
export function restoreArtifact(
  owner: string,
  artifactId: string,
  revisionId: string,
  expectedRevision: number,
): CopyDocument;
export function restoreArtifact(
  owner: string,
  artifactId: string,
  revisionId: string,
  expectedRevision?: number,
): Artifact | CopyDocument {
  const copy = get<CopyDocument>("copy", owner, artifactId);
  if (copy && expectedRevision != null) {
    return selectCopy(owner, copy.id, expectedRevision, Number(revisionId));
  }
  if (copy && !get<Artifact>(KIND, owner, artifactId)) {
    return selectCopy(
      owner,
      copy.id,
      copy.revisions.at(-1)?.revision ?? 0,
      Number(revisionId),
    );
  }
  const artifact = getDesignArtifact(owner, artifactId);
  const revision = artifact.revisions.find(
    (item) => item.revisionId === revisionId,
  );
  if (!revision)
    throw new ApiError(404, "revision_not_found", "找不到這個版本。");
  return recordDesignRevision(owner, {
    artifactId,
    projectId: artifact.projectId,
    workflowId: artifact.workflowId,
    source: artifact.source,
    createdBy: "user",
    design: revision.design,
  });
}

export function forkArtifact(owner: string, artifactId: string): Artifact;
export function forkArtifact(
  owner: string,
  artifactId: string,
  revisionId: string | undefined,
  operationId: string,
): CopyDocument;
export function forkArtifact(
  owner: string,
  artifactId: string,
  revisionId?: string,
  operationId?: string,
): CopyDocument | Artifact {
  const copy = get<CopyDocument>("copy", owner, artifactId);
  if (copy && operationId) {
    const record = copyDocument(owner, artifactId);
    const wanted = Number(revisionId || record.selectedRevision || 0);
    const revision =
      record.revisions.find((row) => row.revision === wanted) ||
      record.revisions.at(-1);
    if (!revision)
      throw new ApiError(404, "revision_not_found", "找不到可分叉的版本。");
    const signature = hash(
      JSON.stringify({ artifactId, revision: revision.revision }),
    );
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
  if (copy && !get<Artifact>(KIND, owner, artifactId))
    throw new ApiError(404, "artifact_not_found", "找不到這個作品。");
  const artifact = getDesignArtifact(owner, artifactId);
  const revision = currentRevision(artifact);
  if (!revision)
    throw new ApiError(404, "revision_not_found", "找不到這個版本。");
  return recordDesignRevision(owner, {
    projectId: artifact.projectId,
    workflowId: null,
    source: artifact.source,
    createdBy: "user",
    design: revision.design,
  });
}
