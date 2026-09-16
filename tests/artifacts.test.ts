import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordArtifact, listRevisions, restoreRevision, forkArtifact } from "../lib/server/artifacts";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-artifact-"));

test("artifact revisions stay in one family", () => {
  const first = recordArtifact({
    projectId: "personal",
    source: "canva",
    title: "茶會海報",
  });
  const second = recordArtifact({
    artifactId: first.artifactId,
    projectId: "personal",
    source: "canva",
    title: "茶會海報",
  });
  assert.equal(second.revision, 2);
  assert.equal(second.revisionId, "v2");
  assert.equal(second.artifactId, first.artifactId);
  const restored = restoreRevision(first.id);
  assert.equal(restored.revision, 3);
  const fork = forkArtifact(second.id);
  assert.notEqual(fork.artifactId, first.artifactId);
  assert.equal(listRevisions(first.artifactId).length, 3);
});
