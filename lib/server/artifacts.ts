import { randomUUID } from "node:crypto";
import { ApiError, redact } from "./security";
import { get, list, put, transaction } from "./store";

const KIND = "artifact";

export type ArtifactRevision = {
  revisionId: string;
  revision: number;
  createdAt: string;
  createdBy: string;
  source: string;
  design: Record<string, unknown>;
};

export type Artifact = {
  id: string;
  projectId: string;
  workflowId: string | null;
  source: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  currentRevisionId: string;
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

function getArtifact(owner: string, id: string) {
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

export function listArtifacts(owner: string, projectId?: string) {
  return list<Artifact>(KIND, owner).filter(
    (item) => !projectId || item.projectId === projectId,
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
      const next = put(KIND, owner, {
        ...existing,
        updatedAt: now,
        currentRevisionId: revision.revisionId,
        revisions: [...existing.revisions, revision],
      } satisfies Artifact);
      syncWorkflowDesign(owner, next);
      return next;
    }
    const created = put(KIND, owner, {
      id: randomUUID(),
      projectId: input.projectId,
      workflowId: input.workflowId || null,
      source: input.source || "canva",
      createdBy: input.createdBy || "hermes",
      createdAt: now,
      updatedAt: now,
      currentRevisionId: revision.revisionId,
      revisions: [revision],
    } satisfies Artifact);
    syncWorkflowDesign(owner, created);
    return created;
  });
}

export function restoreArtifact(
  owner: string,
  artifactId: string,
  revisionId: string,
) {
  const artifact = getArtifact(owner, artifactId);
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

export function forkArtifact(owner: string, artifactId: string) {
  const artifact = getArtifact(owner, artifactId);
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
