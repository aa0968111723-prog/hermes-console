import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-inspiration-cluster-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3288";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";

const { interpretGoal } = await import("../lib/server/orchestrator/goal");
const { routeTools } = await import("../lib/server/orchestrator/tool-router");
const { buildPlan } = await import("../lib/server/orchestrator/planner");
const { emptyIntegration } = await import("../lib/server/certification/registry");
const { searchInspiration, resolveInspirationUrl, selectInspirationDirection } =
  await import("../lib/server/inspiration/engine");
const { isInspirationSearchPack } = await import("../lib/inspiration-pack");
const { callTool, toolsList } = await import("../lib/server/mcp");
const { permissionClass, autoAllowed } = await import(
  "../lib/server/permissions"
);
const { INSPIRATION_INSTRUCTION_PACK } = await import("../lib/server/hermes");
const { composeTaskInstructions } = await import(
  "../lib/server/orchestrator/instructions"
);

const TEA =
  "幫我找淡大禪學社茶會宣傳靈感";

test("tea-party inspiration uses a real clustered workspace tool", () => {
  const goal = interpretGoal(TEA);
  assert.equal(goal.requiresTamkang, true);
  assert.equal(goal.requiresInspiration, true);
  assert.equal(goal.requiresResearch, true);
  assert.equal(goal.requiresDesign, false);
  const routes = routeTools(goal, [
    emptyIntegration("tamkang"),
    emptyIntegration("hermes"),
    emptyIntegration("canva"),
  ]);
  assert.equal(
    routes.find((item) => item.id === "inspiration")?.tool,
    "workspace_search_inspiration",
  );
  assert.equal(
    routes.find((item) => item.id === "audience")?.tool,
    undefined,
  );
  const plan = buildPlan(goal, routes, "balanced");
  const inspiration = plan.steps.find((step) => step.title === "找靈感");
  assert.equal(inspiration?.tool, "workspace_search_inspiration");
  assert.equal(
    plan.steps.find((step) => step.title === "提出創作方向"),
    undefined,
  );
  assert.equal(JSON.stringify(plan).includes("project_inspiration_then_web"), false);
  assert.equal(JSON.stringify(plan).includes("creative_directions"), false);
  assert.equal(JSON.stringify(plan).includes("audience_simulation"), false);
  const composed = composeTaskInstructions({
    mode: "creative",
    text: TEA,
    goal,
  });
  assert.ok(composed.packs.includes("inspiration"));
  assert.match(composed.instructions, /workspace_search_inspiration/);
  assert.match(INSPIRATION_INSTRUCTION_PACK, /workspace_search_inspiration/);
  assert.match(composed.instructions, /不得宣稱已搜尋整個 Instagram/);
});

test("inspiration search clusters saved refs and never claims full-site Instagram", () => {
  const empty = searchInspiration({
    prompt: TEA,
    projectId: "personal",
  });
  assert.equal(empty.fullSiteSearch, false);
  assert.equal(empty.instagramFullSite, false);
  assert.equal(empty.imageRead, false);
  assert.ok(empty.directions.length >= 1);
  assert.ok(empty.directions.every((item) => item.source === "visual_language"));
  assert.equal(isInspirationSearchPack(empty), true);
  assert.match(empty.notice, /不是全站搜尋|沒有搜尋整個/);

  resolveInspirationUrl({
    url: "https://www.instagram.com/p/TeaPartyRef/",
    projectId: "personal",
    caption: "來攤位晃晃，手搖飲在文館左側。新生社博。",
    account: "tku_zc",
  });
  const found = searchInspiration({
    prompt: TEA,
    projectId: "personal",
  });
  assert.equal(found.itemCount, 1);
  assert.ok(found.clusters.some((cluster) => cluster.itemIds.length > 0));
  assert.ok(
    found.directions.some((item) => item.source === "saved_references"),
  );
  assert.equal(found.fullSiteSearch, false);
  assert.doesNotMatch(JSON.stringify(found), /已搜尋整個 Instagram/);
});

test("workspace_search_inspiration is a read-only MCP tool", async () => {
  assert.equal(permissionClass("workspace_search_inspiration"), "read");
  assert.equal(autoAllowed("workspace_search_inspiration"), true);
  const listed = toolsList("workspace").find(
    (tool) => tool.name === "workspace_search_inspiration",
  );
  assert.ok(listed);
  assert.equal(listed?.annotations.readOnlyHint, true);
  const result = await callTool("workspace", "workspace_search_inspiration", {
    prompt: TEA,
    projectId: "personal",
  });
  assert.equal(result.isError, false);
  const text = String((result.content as Array<{ text?: string }>)[0].text);
  const pack = JSON.parse(text) as { fullSiteSearch?: boolean; kind?: string };
  assert.equal(pack.kind, "inspiration_search");
  assert.equal(pack.fullSiteSearch, false);
  assert.match(text, /沒有搜尋整個|不是全站搜尋/);
  assert.doesNotMatch(text, /已搜尋整個 Instagram/);
});

test("selecting a direction saves a workflow and is visible in project context", async () => {
  const first = selectInspirationDirection({
    owner: "workspace",
    prompt: TEA,
    projectId: "personal",
    selected: "A",
  });
  assert.equal(first.workflow.selected, 0);
  assert.equal(first.workflow.state, "ready");
  assert.equal(first.workflow.directions.length, 3);
  assert.ok(first.workflow.directions[0].title);
  const again = selectInspirationDirection({
    owner: "workspace",
    prompt: TEA,
    projectId: "personal",
    selected: "A",
  });
  assert.equal(again.workflow.id, first.workflow.id);
  const switched = selectInspirationDirection({
    owner: "workspace",
    prompt: TEA,
    projectId: "personal",
    selected: "B",
  });
  assert.equal(switched.workflow.id, first.workflow.id);
  assert.equal(switched.workflow.selected, 1);
  const result = await callTool("workspace", "workspace_project_context", {
    projectId: "personal",
  });
  assert.equal(result.isError, false);
  const text = String((result.content as Array<{ text?: string }>)[0].text);
  const context = JSON.parse(text) as {
    workflows?: Array<{ selected: number | null; selectedTitle: string | null }>;
  };
  assert.ok(context.workflows?.some((item) => item.selected === 1));
  assert.ok(context.workflows?.some((item) => item.selectedTitle));
});
