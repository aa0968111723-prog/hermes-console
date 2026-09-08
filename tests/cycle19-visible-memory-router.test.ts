import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { Task, TaskEvent } from "../lib/contracts";
import { EMPTY_USAGE } from "../lib/contracts";

/**
 * LOCAL_CONTRACT only — mock Hermes, not LIVE_EXTERNAL.
 * Cycle 19: visibleText tag leak, empty tool-only tasks, duplicate memory, club routing.
 */
process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-cycle19-visible-memory-router-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3219";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.HERMES_API_KEY = randomBytes(24).toString("hex");
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.HERMES_CONNECT_TIMEOUT_MS = "1000";
process.env.HERMES_IDLE_TIMEOUT_MS = "2000";

type Mode = "ok" | "empty" | "thinking" | "tool_only" | "thinking_tool";
let mode: Mode = "ok";
let lastInstructions = "";
let runOutput = "";

const server = createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer " + process.env.HERMES_API_KEY) {
    res.writeHead(401).end();
    return;
  }
  let body = "";
  for await (const part of req) body += part;
  if (body) {
    try {
      const parsed = JSON.parse(body) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      const system = parsed.messages?.find((item) => item.role === "system");
      if (typeof system?.content === "string") lastInstructions = system.content;
    } catch {
      /* ignore non-JSON */
    }
  }
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models") {
    res.end(JSON.stringify({ data: [{ id: "fixture-agent" }] }));
    return;
  }
  if (req.url === "/v1/capabilities") {
    res.end(
      JSON.stringify({
        object: "hermes.api_server.capabilities",
        features: {
          run_submission: false,
          run_status: true,
          run_stop: false,
        },
      }),
    );
    return;
  }
  if (req.url === "/v1/skills" || req.url === "/v1/toolsets") {
    res.end("[]");
    return;
  }
  if (req.url === "/v1/runs/cycle19_run") {
    res.end(JSON.stringify({ status: "completed", output: runOutput }));
    return;
  }
  if (req.url === "/v1/chat/completions") {
    res.setHeader("Content-Type", "text/event-stream");
    const toolFrame =
      "event: hermes.tool.progress\ndata: " +
      JSON.stringify({
        tool_name: "workspace_save_memory",
        status: "completed",
        preview: "已寫入共用記憶。",
      }) +
      "\n\n";
    const text = (content: string) =>
      "data: " +
      JSON.stringify({
        model: "fixture-agent",
        choices: [{ delta: { content } }],
      }) +
      "\n\n";
    if (mode === "empty") {
      res.end(text("") + "data: [DONE]\n\n");
      return;
    }
    if (mode === "thinking") {
      res.end(
        text("<thinking>內部機密推理鏈</thinking>") + "data: [DONE]\n\n",
      );
      return;
    }
    if (mode === "tool_only") {
      res.end(toolFrame + text("") + "data: [DONE]\n\n");
      return;
    }
    if (mode === "thinking_tool") {
      res.end(
        toolFrame +
          text("<thinking>內部</thinking><reflection>草稿</reflection>") +
          "data: [DONE]\n\n",
      );
      return;
    }
    res.end(text("契約測試回覆，不是實機驗證。") + "data: [DONE]\n\n");
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number };
process.env.HERMES_API_URL = "http://127.0.0.1:" + address.port;

const { visibleText, health } = await import("../lib/server/hermes");
const { put } = await import("../lib/server/store");
const {
  submit,
  reconcile,
  taskFor,
  hasCompletedToolEvents,
} = await import("../lib/server/tasks");
const { saveMemory, memoryDigest } = await import("../lib/server/memory");
const { assembleContext, formatContextForInstructions } = await import(
  "../lib/server/context/assembler"
);
const { routeToolsets, isLumenIntent } = await import(
  "../lib/server/projects/router"
);
const { interpretGoal } = await import("../lib/server/orchestrator/goal");
const { composeTaskInstructions } = await import(
  "../lib/server/orchestrator/instructions"
);

function conv(owner = "workspace") {
  const id = randomUUID();
  put("conversation", owner, {
    id,
    title: "Cycle 19 契約",
    projectId: "personal",
    messages: [],
    hermesSessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return id;
}

async function settle(id: string, owner = "workspace") {
  for (let count = 0; count < 100; count++) {
    const task = taskFor(owner, id);
    if (["failed", "uncertain", "completed", "cancelled"].includes(task.state))
      return task;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Cycle 19 fixture task did not settle");
}

function fakeEvent(partial: Partial<TaskEvent>): TaskEvent {
  return {
    id: randomUUID(),
    taskId: "t",
    toolName: null,
    status: "queued",
    startedAt: new Date().toISOString(),
    endedAt: null,
    summary: "x",
    result: null,
    sources: [],
    error: null,
    usage: null,
    ...partial,
  };
}

function seedRun(events: TaskEvent[], output = "") {
  const conversationId = conv();
  const id = randomUUID();
  put("task", "workspace", {
    id,
    conversationId,
    requestKey: randomUUID(),
    payloadHash: "cycle19",
    state: "running",
    transport: "runs",
    remoteId: "cycle19_run",
    input: "幫我做新生茶會海報",
    attachments: [],
    output,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: null,
    error: null,
    observationError: null,
    events,
    usage: { ...EMPTY_USAGE },
    stopSupported: false,
  } satisfies Task);
  return id;
}

test("Cycle 19: visibleText strips thinking, reflection, scratchpad, tool_calls", () => {
  assert.equal(visibleText("<thought>private</thought>公開"), "公開");
  assert.equal(visibleText("<think>private</think>公開"), "公開");
  assert.equal(visibleText("<analysis>private</analysis>公開"), "公開");
  assert.equal(visibleText("<thinking>Claude 思維鏈</thinking>公開"), "公開");
  assert.equal(visibleText("<reflection>DeepSeek 反思</reflection>公開"), "公開");
  assert.equal(visibleText("<scratchpad>草稿</scratchpad>公開"), "公開");
  assert.equal(visibleText("<tool_call>call()</tool_call>公開"), "公開");
  assert.equal(visibleText("<tool_calls>[{}]</tool_calls>公開"), "公開");
  assert.equal(
    visibleText(
      "<thinking>a</thinking><reflection>b</reflection><scratchpad>c</scratchpad><tool_calls>d</tool_calls>可見",
    ),
    "可見",
  );
});

test("Cycle 19: completed tools are kind===tool; plan completed does not count", () => {
  const toolDone: Task = {
    id: "a",
    conversationId: "c",
    requestKey: "k",
    payloadHash: "h",
    state: "running",
    transport: "chat",
    remoteId: null,
    input: "x",
    attachments: [],
    output: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: null,
    error: null,
    observationError: null,
    events: [
      fakeEvent({ kind: "tool", toolName: "lumen_utter", status: "completed" }),
    ],
    usage: { ...EMPTY_USAGE },
    stopSupported: false,
  };
  assert.equal(hasCompletedToolEvents(toolDone), true);
  const planDone = {
    ...toolDone,
    events: [fakeEvent({ status: "completed", toolName: null })],
  };
  assert.equal(hasCompletedToolEvents(planDone), false);
  const toolRunning = {
    ...toolDone,
    events: [
      fakeEvent({ kind: "tool", toolName: "lumen_utter", status: "running" }),
    ],
  };
  assert.equal(hasCompletedToolEvents(toolRunning), false);
});

test("Cycle 19: 社團 does not hijack Lumen; FrameLab note wins over Lumen", () => {
  assert.equal(isLumenIntent("動畫社團原畫修壞格補張"), false);
  assert.equal(isLumenIntent("吉他社團活動紀錄影片剪輯"), false);
  assert.equal(isLumenIntent("社團"), false);
  assert.equal(isLumenIntent("幫我做新生茶會海報"), true);
  const animation = routeToolsets("動畫社團原畫修壞格補張");
  assert.ok(animation.toolsets.includes("framelab"));
  assert.ok(!animation.toolsets.includes("lumen"));
  assert.ok(!animation.toolsets.includes("tamkang"));
  assert.match(animation.note, /FrameLab/);
  assert.equal(/文宣意圖走 Lumen/.test(animation.note), false);
  const poster = routeToolsets("幫我做新生茶會海報");
  assert.match(poster.note, /Lumen/);
  const booth = routeToolsets("攤位 3D 空間 booth");
  assert.match(booth.note, /planform/);
  const framedText = "幫我修 FrameLab 中間張給動畫社團";
  const framed = composeTaskInstructions({
    mode: "creative",
    text: framedText,
    goal: interpretGoal(framedText),
  });
  assert.equal(framed.includeLumenManual, false);
  assert.equal(framed.includeFramelabManual, true);
});

test("Cycle 19: assembleContext already injects memory; digest is not duplicated", () => {
  const marker = "CYCLE19_UNIQUE_MEMORY_MARKER";
  saveMemory("workspace", {
    kind: "preference",
    scope: "personal",
    title: marker,
    content: "以後海報都要明亮風。",
  });
  const packed = assembleContext({
    owner: "workspace",
    projectId: "personal",
    goalText: "幫我做明亮風新生海報",
    budgetMode: "balanced",
  });
  const framed = formatContextForInstructions(packed);
  const digest = memoryDigest("workspace", "personal");
  assert.match(framed, new RegExp(marker));
  assert.match(framed, /shared_memory/);
  assert.match(digest, new RegExp(marker));
  assert.match(digest, /工作區共用記憶/);
});

test("Cycle 19: empty output fails without tools; completed tools do not fail", async () => {
  await health("workspace", true);
  mode = "empty";
  const empty = await submit("workspace", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "幫我做新生茶會海報",
    attachments: [],
  });
  const emptyDone = await settle(empty.id);
  assert.equal(emptyDone.state, "failed");
  assert.match(emptyDone.error || "", /未產生可顯示的回應/);

  mode = "thinking";
  const thinking = await submit("workspace", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "幫我做新生茶會海報",
    attachments: [],
  });
  const thinkingDone = await settle(thinking.id);
  assert.equal(thinkingDone.state, "failed");
  assert.equal(thinkingDone.output.includes("內部機密推理鏈"), false);

  mode = "tool_only";
  const tools = await submit("workspace", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "幫我做新生茶會海報",
    attachments: [],
  });
  const toolsDone = await settle(tools.id);
  assert.equal(toolsDone.state, "completed");
  assert.equal(hasCompletedToolEvents(toolsDone), true);
  assert.ok(toolsDone.events.some((event) => event.kind === "tool"));

  mode = "thinking_tool";
  const both = await submit("workspace", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "幫我做新生茶會海報",
    attachments: [],
  });
  const bothDone = await settle(both.id);
  assert.equal(bothDone.state, "completed");
  assert.equal(bothDone.output.includes("內部"), false);
});

test("Cycle 19: reconcile fails only when no output and no kind===tool completed events", async () => {
  runOutput = "";
  const planId = seedRun([
    fakeEvent({ status: "completed", toolName: null, summary: "計畫完成" }),
  ]);
  const planDone = await reconcile("workspace", planId);
  assert.equal(planDone.state, "failed");
  assert.match(planDone.error || "", /沒有可讀取的成果/);

  const toolId = seedRun([
    fakeEvent({
      kind: "tool",
      toolName: "workspace_save_memory",
      status: "completed",
      summary: "已寫入共用記憶。",
    }),
  ]);
  const toolDone = await reconcile("workspace", toolId);
  assert.equal(toolDone.state, "completed");
  assert.equal(toolDone.error, null);
});

test("Cycle 19: task instructions include assembled memory once, not memoryDigest", async () => {
  const marker = "CYCLE19_TASK_MEMORY_ONCE";
  saveMemory("workspace", {
    kind: "note",
    scope: "personal",
    title: marker,
    content: "任務指示只應出現一次。",
  });
  mode = "ok";
  lastInstructions = "";
  await health("workspace", true);
  const task = await submit("workspace", {
    conversationId: conv(),
    requestKey: randomUUID(),
    input: "幫我做明亮風新生海報",
    attachments: [],
  });
  await settle(task.id);
  assert.match(lastInstructions, new RegExp(marker));
  assert.match(lastInstructions, /shared_memory/);
  assert.equal(lastInstructions.includes("工作區共用記憶"), false);
  const hits = lastInstructions.split(marker).length - 1;
  assert.equal(hits, 1);
});

test.after(() => {
  server.closeAllConnections();
  server.close();
});
