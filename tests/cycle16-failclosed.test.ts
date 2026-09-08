import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-cycle16-failclosed-"),
);
process.env.CONSOLE_ORIGIN = "https://console.example";
process.env.MCP_BRIDGE_TOKEN = randomBytes(32).toString("hex");
process.env.MCP_REQUIRE_TASK_CONTEXT = "true";

const { ApiError } = await import("../lib/server/security");
const permissions = await import("../lib/server/permissions");
const { bridgeAuth, callTool } = await import("../lib/server/mcp");
const { interpretGoal } = await import("../lib/server/orchestrator/goal");
const { routeTools } = await import("../lib/server/orchestrator/tool-router");
const { buildPlan } = await import("../lib/server/orchestrator/planner");
const { emptyIntegration } = await import("../lib/server/certification/registry");

const bridgeToken = process.env.MCP_BRIDGE_TOKEN;

function mcpRequest(headers: Record<string, string>) {
  return new Request("https://console.example/api/mcp", { headers });
}

test("unknown tools default to write and require confirmation", () => {
  assert.equal(permissions.permissionClass("workspace_list_references"), "read");
  assert.equal(permissions.permissionClass("web_search"), "read");
  assert.equal(permissions.autoAllowed("web_search"), true);
  assert.equal(permissions.permissionClass("workspace_save_directions"), "draft");
  assert.equal(
    permissions.permissionClass("canva_create_selected_draft"),
    "write",
  );
  assert.equal(permissions.permissionClass("instagram_publish"), "publish");
  assert.equal(permissions.permissionClass("delete_material"), "destructive");

  for (const name of [
    "execute_command",
    "run_system_script",
    "shell_exec",
    "send_external_email",
    "deploy_cloud_service",
    "modify_database_record",
    "transfer_credits",
  ]) {
    assert.equal(permissions.permissionClass(name), "write", name);
    assert.equal(permissions.autoAllowed(name), false, name);
    assert.equal(permissions.confirmationRequired(name), true, name);
  }
});

test("missing MCP taskId lookup throws ApiError 404, not TypeError", async () => {
  await assert.rejects(
    () =>
      callTool("workspace", "workspace_list_references", {
        projectId: "personal",
        taskId: randomUUID(),
      }),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 404 &&
      error.code === "task_not_found" &&
      !(error instanceof TypeError),
  );
});

test("bridgeAuth missing CONSOLE_ORIGIN throws ApiError, not TypeError", () => {
  const authorized = {
    Authorization: "Bearer " + bridgeToken,
    Origin: "https://console.example",
  };
  const previous = process.env.CONSOLE_ORIGIN;
  try {
    delete process.env.CONSOLE_ORIGIN;
    assert.throws(
      () => bridgeAuth(mcpRequest(authorized)),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 503 &&
        error.code === "setup_required" &&
        !(error instanceof TypeError),
    );
    process.env.CONSOLE_ORIGIN = "not a url";
    assert.throws(
      () => bridgeAuth(mcpRequest(authorized)),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 503 &&
        error.code === "setup_required" &&
        !(error instanceof TypeError),
    );
  } finally {
    process.env.CONSOLE_ORIGIN = previous;
  }
  assert.equal(
    bridgeAuth(mcpRequest(authorized)),
    "workspace",
  );
  assert.throws(
    () =>
      bridgeAuth(
        mcpRequest({
          Authorization: "Bearer " + bridgeToken,
          Origin: "https://attacker.example",
        }),
      ),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 403 &&
      error.code === "origin_rejected",
  );
});

test("audience plan mentions Tamkang only when requiresTamkang", () => {
  const other = interpretGoal(
    "成大醫學系宣傳海報設計，模擬受眾會喜歡哪種風格",
  );
  assert.equal(other.requiresTamkang, false);
  assert.equal(other.requiresAudienceEvaluation, true);
  const otherPlan = buildPlan(
    other,
    routeTools(other, [
      emptyIntegration("tamkang"),
      emptyIntegration("hermes"),
      emptyIntegration("canva"),
    ]),
  );
  const otherAudience = otherPlan.steps.find((step) => step.title === "受眾模擬");
  assert.ok(otherAudience);
  assert.equal(otherAudience.purpose.includes("淡江"), false);
  assert.match(otherAudience.purpose, /SIMULATION/);

  const campus = interpretGoal(
    "幫我研究最近大一新生會喜歡什麼樣的禪學社招生內容，從淡江新生角度模擬",
  );
  assert.equal(campus.requiresTamkang, true);
  assert.equal(campus.requiresAudienceEvaluation, true);
  const campusPlan = buildPlan(
    campus,
    routeTools(campus, [
      emptyIntegration("tamkang"),
      emptyIntegration("hermes"),
      emptyIntegration("canva"),
    ]),
  );
  const campusAudience = campusPlan.steps.find(
    (step) => step.title === "受眾模擬",
  );
  assert.ok(campusAudience);
  assert.match(campusAudience.purpose, /淡江新生/);
});
