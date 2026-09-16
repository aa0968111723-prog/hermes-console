import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-project-context-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3268";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";

const { assembleContext, formatContextForInstructions } = await import(
  "../lib/server/context/assembler"
);
const { recordArtifact } = await import("../lib/server/artifacts");
const { projectContext } = await import("../lib/server/creative");
const { put } = await import("../lib/server/store");

test("project context includes name and artifact revisions", () => {
  put("project", "workspace", {
    id: "tea-club",
    name: "禪學社茶會",
    createdAt: new Date().toISOString(),
  });
  const first = recordArtifact({
    projectId: "tea-club",
    source: "canva",
    title: "新生茶會海報",
    preview: { title: "v1" },
  });
  const second = recordArtifact({
    artifactId: first.artifactId,
    projectId: "tea-club",
    source: "canva",
    title: "新生茶會海報",
    preview: { title: "v2" },
  });
  assert.equal(second.revisionId, "v2");

  const packed = assembleContext({
    owner: "workspace",
    projectId: "tea-club",
    goalText: "第二版字放大",
    budgetMode: "balanced",
  });
  const project = packed.items.find((item) => item.source === "project");
  assert.equal(project?.title, "禪學社茶會");
  assert.match(project?.content || "", /projectId=tea-club/);
  assert.match(project?.content || "", /禪學社茶會/);
  const artifact = packed.items.find(
    (item) => item.source === "artifact" && item.content.includes("revisionId=v2"),
  );
  assert.ok(artifact);
  assert.match(artifact.content, new RegExp("artifactId=" + first.artifactId));
  assert.doesNotMatch(artifact.content, /preview|credential|token/i);
  const framed = formatContextForInstructions(packed);
  assert.match(framed, /artifactId=/);
  assert.match(framed, /revisionId=v2/);
  assert.match(framed, /禪學社茶會/);

  const index = projectContext("workspace", "tea-club") as {
    name: string;
    artifacts: Array<{ artifactId: string; revisionId: string; title: string }>;
  };
  assert.equal(index.name, "禪學社茶會");
  assert.ok(
    index.artifacts.some(
      (item) =>
        item.artifactId === first.artifactId && item.revisionId === "v2",
    ),
  );
  assert.equal(
    JSON.stringify(index.artifacts).includes("preview"),
    false,
  );
});

test("personal project stays named 個人 when no row exists", () => {
  const packed = assembleContext({
    owner: "workspace",
    projectId: "personal",
    goalText: "幫我做海報",
    budgetMode: "fast",
  });
  const project = packed.items.find((item) => item.source === "project");
  assert.equal(project?.title, "個人");
  assert.match(project?.content || "", /projectId=personal/);
});
