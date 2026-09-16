import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-workspace-audience-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3296";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.HERMES_API_URL = "";
process.env.HERMES_API_KEY = "";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";

const { submit } = await import("../lib/server/tasks");
const { put, get } = await import("../lib/server/store");
const { ApiError } = await import("../lib/server/errors");
const { health } = await import("../lib/server/hermes");
const { isTwinPanel } = await import("../lib/server/audience/personas");
const {
  interpretGoal,
  wantsWorkspaceAudience,
  wantsWorkspaceInspiration,
  wantsWorkspaceKnowledge,
} = await import("../lib/server/orchestrator/goal");

const AUDIENCE = "站在目標客群角度看看，路人會不會滑掉。";

function conv() {
  const id = randomUUID();
  put("conversation", "workspace", {
    id,
    title: "工作區客群契約",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

test("unconfigured Hermes still returns freshman twin for spoken audience asks", async () => {
  const connection = await health("workspace", true);
  assert.notEqual(connection.credential, "valid");
  const goal = interpretGoal(AUDIENCE);
  assert.equal(goal.requiresAudienceEvaluation, true);
  assert.equal(goal.requiresImageReview, false);
  assert.equal(wantsWorkspaceAudience(goal), true);
  assert.equal(wantsWorkspaceInspiration(goal), false);
  assert.equal(wantsWorkspaceKnowledge(goal), false);
  assert.equal(wantsWorkspaceAudience(interpretGoal("幫我找網宣靈感")), false);
  assert.equal(wantsWorkspaceAudience(interpretGoal("這張哪裡可以改？")), false);
  assert.equal(wantsWorkspaceAudience(interpretGoal("只是打個招呼")), false);

  const conversationId = conv();
  const task = await submit("workspace", {
    conversationId,
    requestKey: randomUUID(),
    input: AUDIENCE,
    attachments: [],
  });
  assert.equal(task.state, "completed");
  assert.equal(task.remoteId, null);
  assert.match(task.output, /不是 Hermes Agent 執行/);
  assert.match(task.output, /模擬，不是民調/);
  assert.doesNotMatch(task.output, /已看圖/);
  const tool = task.events.find(
    (event) => event.toolName === "workspace_simulate_audience",
  );
  assert.ok(tool);
  assert.equal(tool?.status, "completed");
  assert.equal(isTwinPanel(tool?.result), true);
  const panel = tool?.result as { personas: unknown[]; truth: string };
  assert.equal(panel.personas.length, 10);
  assert.equal(panel.truth, "SIMULATION");
  assert.equal(
    task.events.some((event) => event.toolName === "workspace_search_inspiration"),
    false,
  );
  const stored = get<{
    messages: Array<{ role: string; provenance?: string }>;
  }>("conversation", "workspace", conversationId);
  const assistant = stored?.messages.filter((item) => item.role === "assistant");
  assert.equal(assistant?.length, 1);
  assert.equal(assistant?.[0].provenance, "workspace");
  assert.equal(get("agent", "workspace", "verified"), null);
});

test("paper lookup still refuses when Hermes is unconfigured", async () => {
  await assert.rejects(
    () =>
      submit("workspace", {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: "幫我查論文",
        attachments: [],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "hermes_not_ready");
      return true;
    },
  );
});
