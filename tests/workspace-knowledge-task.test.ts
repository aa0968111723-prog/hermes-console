import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-workspace-knowledge-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3295";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.HERMES_API_URL = "";
process.env.HERMES_API_KEY = "";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";

const { submit } = await import("../lib/server/tasks");
const { put, get } = await import("../lib/server/store");
const { ApiError } = await import("../lib/server/errors");
const { health } = await import("../lib/server/hermes");
const {
  interpretGoal,
  wantsWorkspaceInspiration,
  wantsWorkspaceKnowledge,
} = await import("../lib/server/orchestrator/goal");
const { isClubKnowledgePack, KNOWLEDGE_TOOL } = await import(
  "../lib/knowledge-pack"
);

const LOOKUP = "幫我查淡大禪學社茶會";

function conv() {
  const id = randomUUID();
  put("conversation", "workspace", {
    id,
    title: "工作區知識契約",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

test("unconfigured Hermes returns club index facts for spoken tea lookup", async () => {
  const connection = await health("workspace", true);
  assert.notEqual(connection.credential, "valid");
  const goal = interpretGoal(LOOKUP);
  assert.equal(goal.intentTier, "lookup");
  assert.equal(wantsWorkspaceInspiration(goal), false);
  assert.equal(wantsWorkspaceKnowledge(goal), true);
  assert.equal(wantsWorkspaceKnowledge(interpretGoal("幫我查論文")), false);
  assert.equal(
    wantsWorkspaceKnowledge(interpretGoal("我想辦禪學社茶會")),
    false,
  );
  assert.equal(wantsWorkspaceKnowledge(interpretGoal("今天社博在哪")), true);
  assert.equal(wantsWorkspaceInspiration(interpretGoal("今天社博在哪")), false);
  assert.equal(wantsWorkspaceKnowledge(interpretGoal("淡江迎新在哪")), true);
  assert.equal(wantsWorkspaceInspiration(interpretGoal("淡江迎新在哪")), false);
  assert.equal(wantsWorkspaceKnowledge(interpretGoal("我想辦迎新")), false);

  const conversationId = conv();
  const requestKey = randomUUID();
  const task = await submit("workspace", {
    conversationId,
    requestKey,
    input: LOOKUP,
    attachments: [],
  });
  assert.equal(task.state, "completed");
  assert.equal(task.transport, "chat");
  assert.equal(task.remoteId, null);
  assert.match(task.output, /不是 Hermes Agent 執行/);
  assert.match(task.output, /沒有搜尋整個 Instagram/);
  assert.match(task.output, /沒有連到淡江資料源/);
  assert.doesNotMatch(task.output, /UNKNOWN/);
  assert.doesNotMatch(task.output, /已搜尋整個 Instagram/);
  const tool = task.events.find((event) => event.toolName === KNOWLEDGE_TOOL);
  assert.ok(tool);
  assert.equal(tool?.status, "completed");
  assert.equal(isClubKnowledgePack(tool?.result), true);
  const pack = tool?.result as {
    live: boolean;
    tamkangLive: boolean;
    hits: Array<{
      title: string;
      claims: Array<{ value: string; status: string }>;
    }>;
  };
  assert.equal(pack.live, false);
  assert.equal(pack.tamkangLive, false);
  assert.ok(pack.hits.some((hit) => /茶會/.test(hit.title)));
  assert.ok(
    pack.hits.some((hit) =>
      hit.claims.some((claim) => claim.value === "未提供"),
    ),
  );
  assert.equal(
    JSON.stringify(pack).includes("UNKNOWN"),
    false,
  );
  assert.equal(get("agent", "workspace", "verified"), null);
  const stored = get<{
    messages: Array<{ role: string; provenance?: string; taskId?: string }>;
  }>("conversation", "workspace", conversationId);
  const assistant = stored?.messages.filter((item) => item.role === "assistant");
  assert.equal(assistant?.length, 1);
  assert.equal(assistant?.[0].provenance, "workspace");
  assert.equal(assistant?.[0].taskId, task.id);
  const again = await submit("workspace", {
    conversationId,
    requestKey,
    input: LOOKUP,
    attachments: [],
  });
  assert.equal(again.id, task.id);
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

test("spoken club questions without 幫我查 still return the Drive index", async () => {
  const prompt = "今天社博在哪";
  const task = await submit("workspace", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: prompt,
    attachments: [],
  });
  assert.equal(task.state, "completed");
  const tool = task.events.find((event) => event.toolName === KNOWLEDGE_TOOL);
  assert.ok(tool);
  assert.equal(isClubKnowledgePack(tool?.result), true);
  const pack = tool?.result as {
    hits: Array<{ title: string; claims: Array<{ value: string }> }>;
  };
  assert.ok(pack.hits.some((hit) => /社博|攤位/.test(hit.title)));
  assert.ok(
    pack.hits.some((hit) =>
      hit.claims.some((claim) => claim.value.includes("文館左側")),
    ),
  );
  assert.match(task.output, /不是 Hermes Agent 執行/);
  assert.doesNotMatch(task.output, /UNKNOWN/);
  assert.equal(
    task.events.some((event) => event.toolName === "workspace_search_inspiration"),
    false,
  );
});

test("spoken orientation facts stay on the Drive index, not a poster mill", async () => {
  const prompt = "淡江迎新在哪";
  const goal = interpretGoal(prompt);
  assert.equal(goal.intentTier, "lookup");
  assert.equal(wantsWorkspaceInspiration(goal), false);
  assert.equal(wantsWorkspaceKnowledge(goal), true);

  const task = await submit("workspace", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: prompt,
    attachments: [],
  });
  assert.equal(task.state, "completed");
  const tool = task.events.find((event) => event.toolName === KNOWLEDGE_TOOL);
  assert.ok(tool);
  assert.equal(isClubKnowledgePack(tool?.result), true);
  const pack = tool?.result as {
    hits: Array<{ title: string; claims: Array<{ value: string }> }>;
  };
  assert.ok(pack.hits.some((hit) => /社博|攤位|入社/.test(hit.title)));
  assert.match(task.output, /不是 Hermes Agent 執行/);
  assert.doesNotMatch(task.output, /UNKNOWN/);
  assert.equal(
    task.events.some((event) => event.toolName === "workspace_search_inspiration"),
    false,
  );
});
