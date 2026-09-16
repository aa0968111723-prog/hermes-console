import { randomUUID } from "node:crypto";
import type { CopyDocument, CopyRevision } from "../creative";
import { get, list, put } from "./store";
import { copyDocument, selectCopy } from "./creative";
import { listMaterials } from "./materials";
import { ApiError, hash } from "./security";

export type ArtifactSource = "copy" | "material";

export type Artifact = {
  artifactId: string;
  revisionId: string;
  projectId: string;
  source: ArtifactSource;
  createdBy: string;
  createdAt: string;
  title: string;
  revision: number;
  previewUrl: string | null;
};

function latestCopy(record: CopyDocument) {
  const selected =
    record.revisions.find((row) => row.revision === record.selectedRevision) ||
    record.revisions.at(-1);
  return selected || null;
}

export function listArtifacts(owner: string, projectId?: string): Artifact[] {
  const copies: Artifact[] = [];
  for (const row of list<CopyDocument>("copy", owner)) {
    if (projectId && row.projectId !== projectId) continue;
    const revision = latestCopy(row);
    if (!revision) continue;
    copies.push({
      artifactId: row.id,
      revisionId: String(revision.revision),
      projectId: row.projectId,
      source: "copy",
      createdBy: revision.actor,
      createdAt: revision.at,
      title: revision.title,
      revision: revision.revision,
      previewUrl: null,
    });
  }
  const materials: Artifact[] = listMaterials(owner, { projectId }).map(
    (row) => ({
      artifactId: row.id,
      revisionId: "1",
      projectId: row.projectId,
      source: "material",
      createdBy: "owner",
      createdAt: row.createdAt,
      title: row.title,
      revision: 1,
      previewUrl: row.kind === "image" ? "/api/materials?id=" + row.id : null,
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

export function forkArtifact(
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
