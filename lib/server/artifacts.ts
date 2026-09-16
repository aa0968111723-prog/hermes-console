import { randomUUID } from "node:crypto";
import { ApiError, WORKSPACE_OWNER } from "./security";
import { get, list, put } from "./store";

export type Artifact = {
  id: string;
  artifactId: string;
  revisionId: string;
  revision: number;
  projectId: string;
  source: string;
  createdBy: string;
  createdAt: string;
  parentArtifactId: string | null;
  workflowId?: string;
  materialId?: string;
  title: string;
};

const KIND = "artifact";

export function listArtifacts(owner = WORKSPACE_OWNER, projectId?: string) {
  return list<Artifact>(KIND, owner).filter(
    (item) => !projectId || item.projectId === projectId,
  );
}

export function listRevisions(artifactId: string, owner = WORKSPACE_OWNER) {
  return listArtifacts(owner)
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
}): Artifact {
  const family = input.artifactId
    ? listRevisions(input.artifactId)
    : [];
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
  };
  return put(KIND, WORKSPACE_OWNER, row);
}

export function restoreRevision(revisionRowId: string) {
  const current = get<Artifact>(KIND, WORKSPACE_OWNER, revisionRowId);
  if (!current) throw new ApiError(404, "not_found", "找不到作品版本。");
  return recordArtifact({
    artifactId: current.artifactId,
    projectId: current.projectId,
    source: current.source,
    createdBy: current.createdBy,
    workflowId: current.workflowId,
    materialId: current.materialId,
    title: current.title,
    parentArtifactId: current.id,
  });
}

export function forkArtifact(revisionRowId: string) {
  const current = get<Artifact>(KIND, WORKSPACE_OWNER, revisionRowId);
  if (!current) throw new ApiError(404, "not_found", "找不到作品版本。");
  return recordArtifact({
    projectId: current.projectId,
    source: current.source,
    createdBy: current.createdBy,
    workflowId: current.workflowId,
    materialId: current.materialId,
    title: current.title + "（副本）",
    parentArtifactId: current.id,
  });
}
