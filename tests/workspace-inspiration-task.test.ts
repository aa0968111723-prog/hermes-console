import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-workspace-inspiration-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3294";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.HERMES_API_URL = "";
process.env.HERMES_API_KEY = "";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";

const { submit } = await import("../lib/server/tasks");
const { put, get } = await import("../lib/server/store");
const { ApiError } = await import("../lib/server/errors");
const { isInspirationSearchPack, directionPickFollowUp } = await import(
  "../lib/inspiration-pack"
);
const { health } = await import("../lib/server/hermes");
const { selectInspirationDirection } = await import(
  "../lib/server/inspiration/engine"
);
const { listArtifacts } = await import("../lib/server/artifacts");
const { listWorkflows } = await import("../lib/server/workflows");
const { interpretGoal, wantsWorkspaceInspiration } = await import(
  "../lib/server/orchestrator/goal"
);

const TEA = "幫我找淡大禪學社茶會宣傳靈感";
const SPOKEN_CREATE = "我想辦禪學社茶會";
const SPOKEN_ORIENTATION = "我想辦迎新";

function conv() {
  const id = randomUUID();
  put("conversation", "workspace", {
    id,
    title: "工作區靈感契約",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

test("unconfigured Hermes still returns workspace inspiration directions", async () => {
  const connection = await health("workspace", true);
  assert.notEqual(connection.credential, "valid");
  const conversationId = conv();
  const requestKey = randomUUID();
  const task = await submit("workspace", {
    conversationId,
    requestKey,
    input: TEA,
    attachments: [],
  });
  assert.equal(task.state, "completed");
  assert.equal(task.transport, "chat");
  assert.equal(task.remoteId, null);
  assert.equal(task.stopSupported, false);
  assert.equal(task.goal?.requiresInspiration, true);
  assert.match(task.output, /不是 Hermes Agent 執行/);
  assert.match(task.output, /沒有搜尋整個 Instagram/);
  assert.match(task.output, /沒有連到淡江資料源/);
  assert.doesNotMatch(task.output, /已搜尋整個 Instagram/);
  const tool = task.events.find(
    (event) => event.toolName === "workspace_search_inspiration",
  );
  assert.ok(tool);
  assert.equal(tool?.status, "completed");
  assert.equal(isInspirationSearchPack(tool?.result), true);
  const pack = tool?.result as { directions: Array<{ id: string }> };
  assert.ok(pack.directions.some((item) => item.id === "A"));
  assert.equal(get("agent", "workspace", "verified"), null);
  const stored = get<{
    messages: Array<{
      role: string;
      provenance?: string;
      taskId?: string;
      content: string;
    }>;
  }>("conversation", "workspace", conversationId);
  const assistant = stored?.messages.filter((item) => item.role === "assistant");
  assert.equal(assistant?.length, 1);
  assert.equal(assistant?.[0].provenance, "workspace");
  assert.equal(assistant?.[0].taskId, task.id);
  assert.match(assistant?.[0].content || "", /不是 Hermes Agent 執行/);
  const again = await submit("workspace", {
    conversationId,
    requestKey,
    input: TEA,
    attachments: [],
  });
  assert.equal(again.id, task.id);
  assert.equal(
    stored &&
      get<{ messages: unknown[] }>("conversation", "workspace", conversationId)
        ?.messages.filter((item) => (item as { role: string }).role === "assistant")
        .length,
    1,
  );
});

test("non-inspiration chat still refuses when Hermes is unconfigured", async () => {
  await assert.rejects(
    () =>
      submit("workspace", {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: "只是打個招呼，今天好嗎",
        attachments: [],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "hermes_not_ready");
      return true;
    },
  );
  await assert.rejects(
    () =>
      submit("workspace", {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: directionPickFollowUp("A", "淡大禪學社茶會・手搖飲場景"),
        attachments: [],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "hermes_not_ready");
      return true;
    },
  );
  await assert.rejects(
    () =>
      submit("workspace", {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: "請接續修改同一作品。",
        attachments: [],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "hermes_not_ready");
      return true;
    },
  );
  assert.equal(get("agent", "workspace", "verified"), null);
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

test("spoken create tea asks still return workspace inspiration", async () => {
  const spokenCreate = interpretGoal(SPOKEN_CREATE);
  assert.equal(spokenCreate.requiresInspiration, false);
  assert.equal(spokenCreate.requiresDesign, false);
  assert.equal(spokenCreate.requiresTamkang, false);
  assert.equal(spokenCreate.intentTier, "create");
  assert.equal(wantsWorkspaceInspiration(spokenCreate), true);
  assert.equal(
    wantsWorkspaceInspiration(interpretGoal("我想辦茶會 再幫我看場佈")),
    true,
  );
  assert.equal(
    wantsWorkspaceInspiration(interpretGoal("幫我查淡大禪學社茶會")),
    false,
  );
  assert.equal(wantsWorkspaceInspiration(interpretGoal("幫我查論文")), false);

  const conversationId = conv();
  const task = await submit("workspace", {
    conversationId,
    requestKey: randomUUID(),
    input: SPOKEN_CREATE,
    attachments: [],
  });
  assert.equal(task.state, "completed");
  assert.equal(task.remoteId, null);
  assert.match(task.output, /不是 Hermes Agent 執行/);
  assert.match(task.output, /沒有搜尋整個 Instagram/);
  assert.doesNotMatch(task.output, /已搜尋整個 Instagram/);
  assert.doesNotMatch(task.output, /沒有連到淡江資料源/);
  const tool = task.events.find(
    (event) => event.toolName === "workspace_search_inspiration",
  );
  assert.ok(tool);
  assert.equal(tool?.status, "completed");
  assert.equal(isInspirationSearchPack(tool?.result), true);
  const stored = get<{
    messages: Array<{ role: string; provenance?: string }>;
  }>("conversation", "workspace", conversationId);
  const assistant = stored?.messages.filter((item) => item.role === "assistant");
  assert.equal(assistant?.length, 1);
  assert.equal(assistant?.[0].provenance, "workspace");
  assert.equal(get("agent", "workspace", "verified"), null);
});

test("spoken orientation and booth layout still return workspace inspiration", async () => {
  const spoken = interpretGoal(SPOKEN_ORIENTATION);
  assert.equal(spoken.intentTier, "create");
  assert.equal(wantsWorkspaceInspiration(spoken), true);
  assert.equal(
    wantsWorkspaceInspiration(interpretGoal("幫我場佈")),
    true,
  );
  assert.equal(
    wantsWorkspaceInspiration(interpretGoal("淡江迎新在哪")),
    false,
  );
  assert.equal(wantsWorkspaceInspiration(interpretGoal("我想辦活動")), true);
  assert.equal(wantsWorkspaceInspiration(interpretGoal("我想擺攤")), true);
  assert.equal(wantsWorkspaceInspiration(interpretGoal("茶會幾點")), false);
  assert.equal(
    wantsWorkspaceInspiration(interpretGoal("幫我研究禪學社招生靈感")),
    true,
  );

  const conversationId = conv();
  const task = await submit("workspace", {
    conversationId,
    requestKey: randomUUID(),
    input: SPOKEN_ORIENTATION,
    attachments: [],
  });
  assert.equal(task.state, "completed");
  assert.equal(task.remoteId, null);
  assert.match(task.output, /不是 Hermes Agent 執行/);
  const tool = task.events.find(
    (event) => event.toolName === "workspace_search_inspiration",
  );
  assert.ok(tool);
  assert.equal(tool?.status, "completed");
  assert.equal(isInspirationSearchPack(tool?.result), true);
  assert.equal(
    task.events.some((event) => event.toolName === "zenclub_drive_index"),
    false,
  );
  const stored = get<{
    messages: Array<{ role: string; provenance?: string }>;
  }>("conversation", "workspace", conversationId);
  const assistant = stored?.messages.filter((item) => item.role === "assistant");
  assert.equal(assistant?.length, 1);
  assert.equal(assistant?.[0].provenance, "workspace");
  assert.equal(get("agent", "workspace", "verified"), null);

  const activity = await submit("workspace", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "我想辦活動",
    attachments: [],
  });
  assert.equal(activity.state, "completed");
  assert.ok(
    activity.events.some(
      (event) => event.toolName === "workspace_search_inspiration",
    ),
  );
  assert.equal(
    activity.events.some((event) => event.toolName === "zenclub_drive_index"),
    false,
  );

  const booth = await submit("workspace", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "我想擺攤",
    attachments: [],
  });
  assert.equal(booth.state, "completed");
  assert.ok(
    booth.events.some(
      (event) => event.toolName === "workspace_search_inspiration",
    ),
  );
  assert.equal(
    booth.events.some((event) => event.toolName === "zenclub_drive_index"),
    false,
  );
});

test("unconfigured Hermes revises the same spec when asked to enlarge type", async () => {
  const conversationId = conv();
  await submit("workspace", {
    conversationId,
    requestKey: randomUUID(),
    input: TEA,
    attachments: [],
  });
  const picked = selectInspirationDirection({
    owner: "workspace",
    prompt: TEA,
    projectId: "personal",
    selected: "A",
    conversationId,
  });
  assert.equal(picked.workflow.directionBrief?.revision, 1);
  const continued = await submit("workspace", {
    conversationId,
    requestKey: randomUUID(),
    input: "請接續修改同一作品。",
    attachments: [],
  });
  assert.equal(continued.state, "completed");
  assert.match(continued.output, /同一件規格草稿/);
  assert.match(continued.output, /還沒出圖/);
  assert.doesNotMatch(continued.output, /主標加大/);
  const afterContinue = listWorkflows("workspace").find(
    (item) => item.conversationId === conversationId,
  );
  assert.equal(afterContinue?.directionBrief?.revision, 1);
  assert.equal(afterContinue?.artifactId, picked.workflow.artifactId);
  assert.equal(
    listArtifacts("workspace", "personal").find(
      (item) => item.id === afterContinue?.artifactId,
    )?.revisions.length,
    1,
  );
  const revised = await submit("workspace", {
    conversationId,
    requestKey: randomUUID(),
    input: "第二版字放大",
    attachments: [],
  });
  assert.equal(revised.state, "completed");
  assert.match(revised.output, /規則修訂/);
  assert.match(revised.output, /不是已出圖/);
  assert.match(revised.output, /不是 Canva/);
  const assistant = get<{
    messages: Array<{ provenance?: string; taskId?: string }>;
  }>("conversation", "workspace", conversationId)?.messages.filter(
    (item) => item.taskId === revised.id,
  );
  assert.equal(
    assistant?.some((item) => item.provenance === "workspace"),
    true,
  );
  const workflow = listWorkflows("workspace").find(
    (item) => item.conversationId === conversationId,
  );
  assert.equal(workflow?.artifactId, picked.workflow.artifactId);
  assert.equal(workflow?.directionBrief?.revision, 2);
  assert.match(workflow?.directionBrief?.visualNote || "", /主標加大/);
  assert.equal(workflow?.directionBrief?.rendered, false);
  assert.equal(workflow?.directionBrief?.hermesGenerated, false);
  const artifact = listArtifacts("workspace", "personal").find(
    (item) => item.id === workflow?.artifactId,
  );
  assert.equal(artifact?.source, "workspace");
  assert.equal(artifact?.revisions.length, 2);
  assert.equal(get("agent", "workspace", "verified"), null);
});

test("after a spec, spoken 出圖 stays on the same draft instead of a new poster mill", async () => {
  const { isContinueSameWorkRequest, isMakeSelectedPosterRequest } = await import(
    "../lib/server/inspiration/revise"
  );
  assert.equal(isMakeSelectedPosterRequest("幫我出圖"), true);
  assert.equal(isContinueSameWorkRequest("幫我做一張網宣海報。"), true);
  assert.equal(isContinueSameWorkRequest("幫我找網宣靈感。"), false);

  const freshPoster = await submit("workspace", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "幫我做一張網宣海報。",
    attachments: [],
  });
  assert.equal(freshPoster.state, "completed");
  assert.ok(
    freshPoster.events.some(
      (event) => event.toolName === "workspace_search_inspiration",
    ),
  );

  const conversationId = conv();
  await submit("workspace", {
    conversationId,
    requestKey: randomUUID(),
    input: TEA,
    attachments: [],
  });
  const picked = selectInspirationDirection({
    owner: "workspace",
    prompt: TEA,
    projectId: "personal",
    selected: "A",
    conversationId,
  });
  const revisionBefore = picked.workflow.directionBrief?.revision;
  const poster = await submit("workspace", {
    conversationId,
    requestKey: randomUUID(),
    input: "幫我出圖",
    attachments: [],
  });
  assert.equal(poster.state, "completed");
  assert.match(poster.output, /同一件規格草稿/);
  assert.match(poster.output, /還沒出圖/);
  assert.equal(
    poster.events.some(
      (event) => event.toolName === "workspace_search_inspiration",
    ),
    false,
  );
  assert.ok(
    poster.events.some(
      (event) => event.toolName === "workspace_continue_direction_spec",
    ),
  );
  const workflow = listWorkflows("workspace").find(
    (item) => item.conversationId === conversationId,
  );
  assert.equal(workflow?.artifactId, picked.workflow.artifactId);
  assert.equal(workflow?.directionBrief?.revision, revisionBefore);
  assert.equal(workflow?.directionBrief?.rendered, false);

  const chip = await submit("workspace", {
    conversationId,
    requestKey: randomUUID(),
    input: "幫我做一張網宣海報。",
    attachments: [],
  });
  assert.equal(chip.state, "completed");
  assert.match(chip.output, /同一件規格草稿/);
  assert.equal(
    chip.events.some(
      (event) => event.toolName === "workspace_search_inspiration",
    ),
    false,
  );
});

test("after a spec, spoken 顏色改暖 revises the same draft instead of 503", async () => {
  const conversationId = conv();
  await submit("workspace", {
    conversationId,
    requestKey: randomUUID(),
    input: TEA,
    attachments: [],
  });
  const picked = selectInspirationDirection({
    owner: "workspace",
    prompt: TEA,
    projectId: "personal",
    selected: "A",
    conversationId,
  });
  const revisionBefore = picked.workflow.directionBrief?.revision || 0;
  await assert.rejects(
    () =>
      submit("workspace", {
        conversationId: conv(),
        requestKey: randomUUID(),
        input: "顏色改暖一點",
        attachments: [],
      }),
    (error: unknown) =>
      error instanceof ApiError && error.code === "hermes_not_ready",
  );
  const revised = await submit("workspace", {
    conversationId,
    requestKey: randomUUID(),
    input: "顏色改暖一點",
    attachments: [],
  });
  assert.equal(revised.state, "completed");
  assert.match(revised.output, /配色偏暖/);
  assert.match(revised.output, /不是已出圖/);
  assert.match(revised.output, /不是 Canva/);
  assert.equal(
    revised.events.some(
      (event) => event.toolName === "workspace_revise_direction_spec",
    ),
    true,
  );
  const workflow = listWorkflows("workspace").find(
    (item) => item.conversationId === conversationId,
  );
  assert.equal(workflow?.directionBrief?.revision, revisionBefore + 1);
  assert.match(workflow?.directionBrief?.visualNote || "", /配色偏暖/);
  assert.equal(workflow?.directionBrief?.rendered, false);
});
