import test from "node:test";
import assert from "node:assert/strict";
import { spatialMode, importantNodes } from "../lib/client/spatial";
test("spatial rendering follows preferences, not invented performance scores", () => {
  const base = {
    animation: true,
    reduceMotion: false,
    mobile: false,
    cores: 8,
    memory: 8,
  };
  assert.equal(spatialMode(base), "full");
  assert.equal(spatialMode({ ...base, mobile: true }), "reduced");
  assert.equal(spatialMode({ ...base, cores: 2 }), "reduced");
  assert.equal(spatialMode({ ...base, saveData: true }), "reduced");
  assert.equal(spatialMode({ ...base, reduceMotion: true }), "static");
  assert.equal(spatialMode({ ...base, animation: false }), "static");
});
test("important nodes are bounded, prioritize actual tool activity and never invent roles", () => {
  const nodes = Array.from({ length: 12 }, (_, i) => ({
    id: "node" + i,
    status: i === 11 ? "unconfigured" : "available",
    tools: ["tool_" + i],
  }));
  assert.equal(importantNodes(nodes, null, 4).length, 4);
  assert.equal(importantNodes(nodes, "tool_11", 4)[0].id, "node11");
  assert.deepEqual(
    importantNodes(
      [{ id: "unknown", status: "unconfigured", tools: [] }],
      null,
      4,
    ),
    [],
  );
  assert.deepEqual(importantNodes(nodes, null, 0), []);
});
