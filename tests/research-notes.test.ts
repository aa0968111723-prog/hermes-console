import test from "node:test";
import assert from "node:assert/strict";
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
});
