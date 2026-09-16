import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-research-notes-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3261";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";

const { searchResearchNotes } = await import("../lib/server/research/nodes");
const { interpretGoal } = await import("../lib/server/orchestrator/goal");
const { routeTools } = await import("../lib/server/orchestrator/tool-router");
const { buildPlan } = await import("../lib/server/orchestrator/planner");
const { callTool, toolsList } = await import("../lib/server/mcp");

test("research notes are local nodes with provenance, not deployed capability", () => {
  const found = searchResearchNotes("CUDA graph multimodal encoder");
  assert.match(found.notice, /不是外部已驗證文獻/);
  assert.ok(found.nodes.length >= 1);
  const node = found.nodes[0]!;
  assert.equal(node.confidence, 0.4);
  assert.match(node.source, /^data\/ai-agent-research\//);
  assert.ok(node.createdAt);
  assert.ok(node.finding.length > 20);
  const empty = searchResearchNotes(" ");
  assert.equal(empty.nodes.length, 0);
});

test("Tamkang campaign does not open the research-note tool", () => {
  const goal = interpretGoal("幫我找淡江新生最近可能喜歡的社團宣傳方向");
  assert.equal(goal.requiresLocalNotes, false);
  const plan = buildPlan(goal, routeTools(goal, []));
  assert.equal(
    plan.steps.some((step) => step.tool === "workspace_search_research"),
    false,
  );
});

test("agent-runtime notes can be retrieved without the user picking a library", async () => {
  const goal = interpretGoal("查倉庫研究筆記裡 multimodal encoder CUDA graphs");
  assert.equal(goal.requiresLocalNotes, true);
  assert.ok(
    toolsList("workspace").some((tool) => tool.name === "workspace_search_research"),
  );
  const plan = buildPlan(goal, routeTools(goal, []));
  assert.ok(plan.steps.some((step) => step.tool === "workspace_search_research"));
  const listed = await callTool("workspace", "workspace_search_research", {
    q: "CUDA graphs",
  });
  assert.equal(listed.isError, false);
  const payload = JSON.parse(
    String((listed.content as Array<{ text?: string }>)[0]?.text || "{}"),
  ) as { notice: string; nodes: Array<{ confidence: number }> };
  assert.match(payload.notice, /倉庫研究筆記/);
  assert.equal(payload.nodes[0]?.confidence, 0.4);
});
