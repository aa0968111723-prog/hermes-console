import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-artifact-revisions-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3344";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";

const { put } = await import("../lib/server/store");
const {
  applySuccessfulDesign,
  designHasContent,
  forkArtifact,
  normalizeWorkflow,
  restoreArtifact,
} = await import("../lib/server/workflows");
const { seedSession } = await import("./session-fixture");
const route = await import("../app/api/workflows/route");

function sample(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    projectId: "personal",
    brief: "茶會宣傳",
    directions: [],
    selected: 0,
    state: "draft_ready" as const,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    canvaJobId: "job-1",
    design: { id: "design-v1", title: "第一版" },
    error: null,
    ...extra,
  };
}

test("empty Canva payloads are not treated as a usable design", () => {
  assert.equal(designHasContent({}), false);
  assert.equal(designHasContent({ id: "   " }), false);
  assert.equal(designHasContent({ id: "dsn_1" }), true);
  assert.equal(
    designHasContent({ thumbnail: { url: "https://www.canva.com/p.png" } }),
    true,
  );
});

test("successful designs append revisions and restore keeps the same artifact id", () => {
  const first = applySuccessfulDesign(sample("a".repeat(64)), {
    id: "design-v1",
    title: "第一版",
  });
  assert.equal(first.artifactId, first.id);
  assert.equal(first.revisions?.length, 1);
  assert.equal(first.activeRevision, 1);
  const second = applySuccessfulDesign(first, {
    id: "design-v2",
    title: "第二版字放大",
  });
  assert.equal(second.id, first.id);
  assert.equal(second.revisions?.length, 2);
  assert.equal(second.activeRevision, 2);
  assert.equal(second.design?.title, "第二版字放大");
  const again = applySuccessfulDesign(second, {
    id: "design-v2",
    title: "第二版字放大",
  });
  assert.equal(again.revisions?.length, 2);
  put("workflow", "workspace", second);
  const restored = restoreArtifact("workspace", second.id, 1);
  assert.equal(restored.id, second.id);
  assert.equal(restored.activeRevision, 1);
  assert.equal(restored.design?.title, "第一版");
  assert.equal(restored.revisions?.length, 2);
});

test("fork copies a revision onto a new artifact without dropping the original", () => {
  const id = "b".repeat(64);
  const record = applySuccessfulDesign(
    applySuccessfulDesign(sample(id), { id: "design-v1", title: "第一版" }),
    { id: "design-v2", title: "第二版" },
  );
  put("workflow", "workspace", record);
  const fork = forkArtifact("workspace", id, 1);
  assert.notEqual(fork.id, id);
  assert.equal(fork.parentArtifactId, id);
  assert.equal(fork.design?.title, "第一版");
  assert.equal(fork.activeRevision, 1);
  assert.equal(fork.canvaJobId, null);
  assert.equal(fork.state, "ready");
  const original = restoreArtifact("workspace", id, 2);
  assert.equal(original.design?.title, "第二版");
  const again = forkArtifact("workspace", id, 1);
  assert.equal(again.id, fork.id);
});

test("legacy rows without revisions hydrate V1 from the stored design", () => {
  const hydrated = normalizeWorkflow(sample("c".repeat(64)));
  assert.equal(hydrated.revisions?.length, 1);
  assert.equal(hydrated.activeRevision, 1);
  assert.equal(hydrated.artifactId, hydrated.id);
});

test("workflow PATCH restore and fork require a session", async () => {
  const id = "d".repeat(64);
  const record = applySuccessfulDesign(sample(id), {
    id: "design-v1",
    title: "第一版",
  });
  put("workflow", "workspace", record);
  const origin = "http://localhost:3344";
  const denied = await route.PATCH(
    new Request(origin + "/api/workflows", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ id, restoreRevision: 1 }),
    }),
  );
  assert.equal(denied.status, 401);
  const { cookie } = seedSession();
  const restored = await route.PATCH(
    new Request(origin + "/api/workflows", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        Cookie: cookie,
      },
      body: JSON.stringify({ id, restoreRevision: 1 }),
    }),
  );
  assert.equal(restored.status, 200);
  const body = await restored.json();
  assert.equal(body.workflow.activeRevision, 1);
  const forked = await route.PATCH(
    new Request(origin + "/api/workflows", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        Cookie: cookie,
      },
      body: JSON.stringify({ id, fork: true, forkRevision: 1 }),
    }),
  );
  assert.equal(forked.status, 200);
  const forkBody = await forked.json();
  assert.equal(forkBody.workflow.parentArtifactId, id);
  assert.notEqual(forkBody.workflow.id, id);
});
