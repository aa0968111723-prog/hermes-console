import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { searchResearch } from "../lib/server/research/notes";

test("research notes are searchable snapshots, not dumped into chat", () => {
  const hit = searchResearch("CUDA Graph shape bucketing");
  assert.ok(hit.nodes.length >= 1);
  assert.match(hit.nodes[0].title, /CUDA Graph|Shape Bucketing|ExecutionPlanCache/i);
  assert.equal(hit.nodes[0].confidence, "snapshot");
  assert.match(hit.notice, /不得編造/);
  const miss = searchResearch("禪學社茶會海報靈感");
  assert.equal(miss.nodes.length, 0);
  const empty = searchResearch("a");
  assert.equal(empty.nodes.length, 0);
  const multimodal = searchResearch("Qwen2.5-VL MRoPE token geometry");
  assert.ok(multimodal.nodes.length >= 1);
  assert.match(
    multimodal.nodes[0].title + " " + multimodal.nodes[0].finding,
    /Qwen2\.5-VL|MRoPE|token geometry/i,
  );
  assert.equal(multimodal.nodes[0].confidence, "snapshot");
  const cacheIdentity = searchResearch(
    "multimodal cache identity processor policy",
  );
  assert.ok(cacheIdentity.nodes.length >= 1);
  assert.match(
    cacheIdentity.nodes[0].id,
    /2026-09-16-multimodal-cache-identity/,
  );
  assert.match(
    cacheIdentity.nodes[0].title + " " + cacheIdentity.nodes[0].finding,
    /Media Identity|Processing Identity|Encoder Identity|processor policy/i,
  );
  assert.equal(cacheIdentity.nodes[0].confidence, "snapshot");
});

test("new research snapshots are searchable without process restart", () => {
  searchResearch("CUDA Graph");
  const token = "CACHE_IDENTITY_PROBE_" + randomUUID().replace(/-/g, "").slice(0, 10);
  const filename = "2099-01-01-" + token.toLowerCase() + ".md";
  const path = join(process.cwd(), "data/ai-agent-research", filename);
  writeFileSync(
    path,
    [
      "# Probe",
      "",
      "**主題：" + token + "**",
      "",
      "## 本小時新發現",
      token + " processor policy cache invalidation.",
      "",
    ].join("\n"),
  );
  try {
    const hit = searchResearch(token);
    assert.equal(hit.nodes.length, 1);
    assert.equal(hit.nodes[0].id, filename.replace(/\.md$/, ""));
    assert.equal(hit.nodes[0].confidence, "snapshot");
  } finally {
    unlinkSync(path);
  }
});
