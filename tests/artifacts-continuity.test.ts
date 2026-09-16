import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { seedSession } from "./session-fixture";
import type { CopyDocument } from "../lib/creative";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-artifacts-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3268";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
const { cookie } = seedSession();

const { put } = await import("../lib/server/store");
const {
  forkArtifact,
  listArtifacts,
  restoreArtifact,
} = await import("../lib/server/artifacts");
const { copyDocument } = await import("../lib/server/creative");
const artifacts = await import("../app/api/artifacts/route");
const { continueCopy, revisionLabel } = await import(
  "../lib/client/artifacts"
);
const { focusInstructions } = await import(
  "../lib/server/orchestrator/instructions"
);

function revision(
  number: number,
  body: string,
  activityId: string,
): CopyDocument["revisions"][number] {
  return {
    projectId: "personal",
    activityId,
    title: "茶會宣傳 " + number,
    format: "post",
    tone: "",
    audience: "",
    pages: [{ title: "主視覺", body, visual: "海報" }],
    materialIds: [],
    factIds: [],
    revision: number,
    at: "2026-01-0" + number + "T00:00:00.000Z",
    actor: number === 1 ? "hermes" : "owner",
    activityRevision: 1,
  };
}

test("copy artifacts keep stable ids, versions, restore and fork", () => {
  const activityId = randomUUID();
  const artifactId = randomUUID();
  put("copy", "workspace", {
    id: artifactId,
    projectId: "personal",
    activityId,
    selectedRevision: 1,
    revisions: [
      revision(1, "第一版小字", activityId),
      revision(2, "第二版大字", activityId),
    ],
  } satisfies CopyDocument);
  const listed = listArtifacts("workspace", "personal").filter(
    (row) => row.source === "copy",
  );
  assert.equal(listed.length, 1);
  assert.equal(listed[0].artifactId, artifactId);
  assert.equal(listed[0].revision, 1);
  assert.equal(listed[0].expectedRevision, 2);
  assert.equal(listed[0].revisions.length, 2);
  assert.match(listed[0].revisions[1].excerpt || "", /第二版大字/);
  restoreArtifact("workspace", artifactId, "2", 2);
  assert.equal(copyDocument("workspace", artifactId).selectedRevision, 2);
  const forked = forkArtifact(
    "workspace",
    artifactId,
    "1",
    randomUUID(),
  );
  assert.notEqual(forked.id, artifactId);
  assert.equal(forked.revisions.length, 1);
  assert.match(forked.revisions[0].pages[0].body, /第一版小字/);
  const continued = continueCopy(artifactId, 2);
  assert.match(continued.text, /第 2 版/);
  assert.doesNotMatch(continued.text, /workspace_/);
  assert.doesNotMatch(continued.text, new RegExp(artifactId));
  assert.equal(continued.focus.copyId, artifactId);
  assert.equal(continued.focus.revision, 2);
  assert.match(focusInstructions(continued.focus), /workspace_get_copy/);
  assert.match(focusInstructions(continued.focus), new RegExp(artifactId));
  assert.equal(revisionLabel(3), "V3");
});

test("artifact restore requires a workspace session", async () => {
  const previous = process.env.CONSOLE_TEST_SESSION;
  delete process.env.CONSOLE_TEST_SESSION;
  try {
    const unauthorized = await artifacts.POST(
      new Request("http://localhost:3268/api/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3268",
        },
        body: JSON.stringify({
          action: "restore",
          artifactId: randomUUID(),
          revisionId: "1",
          expectedRevision: 1,
        }),
      }),
    );
    assert.equal(unauthorized.status, 401);
  } finally {
    if (previous) process.env.CONSOLE_TEST_SESSION = previous;
  }
  const missing = await artifacts.POST(
    new Request("http://localhost:3268/api/artifacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3268",
        Cookie: cookie,
      },
      body: JSON.stringify({
        action: "restore",
        artifactId: randomUUID(),
        revisionId: "1",
        expectedRevision: 1,
      }),
    }),
  );
  assert.ok([403, 404].includes(missing.status));
});
