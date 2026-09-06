import test from "node:test";
import assert from "node:assert/strict";
import { getMemoryInventory, addMemory } from "../lib/server/hermes/memory.ts";
import { recordUsage, getUsageSummary } from "../lib/server/hermes/usage.ts";
import { executeOrchestratedTask } from "../lib/server/orchestrator/task-orchestrator.ts";
import { TASK_LIMITS } from "../lib/server/orchestrator/limits.ts";
import { aggregateUsage } from "../lib/server/usage.ts";
import { resolvePersonasForContext } from "../lib/server/audience-twin/engine.ts";

test("Phase 2 memory layers, usage telemetry and task limits", async (t) => {
  await t.test("does not fabricate Hermes MEMORY.md and labels console layers", () => {
    const inventory = getMemoryInventory("tku-zen-agent");
    assert.equal(inventory.fabricatedHermesMemory, false);
    const hermes = inventory.layers.find((layer) => layer.id === "hermes_memory");
    const seed = inventory.layers.find((layer) => layer.id === "console_seed");
    assert.equal(hermes?.available, false);
    assert.equal(hermes?.items.length, 0);
    assert.ok(hermes?.note.includes("MEMORY.md"));
    assert.equal(seed?.source, "console");
    assert.ok((seed?.items.length || 0) > 0);
    const created = addMemory({
      type: "insight",
      project: "tku-zen-agent",
      title: "專案筆記",
      content: "使用者新增的專案脈絡",
      evidenceType: "campus_observation",
      tags: ["project"],
    });
    assert.equal(created.sourceLayer, "project_context");
  });

  await t.test("usage records profile/project/run fields and does not invent USD cost", () => {
    recordUsage({
      sessionKey: "project:phase2",
      profileId: "tku",
      agent: "tku",
      project: "tku-zen-agent",
      conversation: "conv_1",
      run: "run_1",
      model: "hermes-agent",
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      latencyMs: 12,
      toolCallsCount: 1,
      toolErrors: 0,
      toolsUsed: ["query_tku_campus_info"],
      tokenSource: "upstream",
    });
    const summary = getUsageSummary("project:phase2");
    assert.equal(summary.totalTokens, 30);
    assert.equal(summary.totalToolCalls, 1);
    const durable = aggregateUsage("all");
    assert.equal(durable.cost, null);
    assert.ok(durable.costNotice);
    assert.ok(!JSON.stringify(durable).includes("$"));
  });

  await t.test("task orchestration stays within depth and fan-out limits", async () => {
    const result = await executeOrchestratedTask("幫我做給淡江大學大一新生看的禪學社茶會網宣", {
      activeProject: "tku-zen-agent",
    });
    assert.equal(result.limits.maxDepth, 2);
    assert.ok(result.directions.length <= TASK_LIMITS.maxCreativeDirections);
    assert.ok(result.subtasks.length <= 9);
    const personas = resolvePersonasForContext("淡江大一新生", "tku-zen-agent").personas;
    assert.ok(personas.length <= TASK_LIMITS.maxAudienceRoles);
    const memoryTask = result.subtasks.find((item) => item.subtaskId === "memory_retrieval");
    const memoryItems = memoryTask?.outputData as unknown[];
    assert.ok(Array.isArray(memoryItems));
    assert.ok(memoryItems.length <= TASK_LIMITS.maxResearchSources);
  });
});
