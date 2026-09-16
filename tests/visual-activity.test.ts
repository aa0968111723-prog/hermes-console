import test from "node:test";
import assert from "node:assert/strict";
import {
  activityKind,
  artifactsForConversation,
  designsFromTask,
  eventPhaseLabel,
  eventStateLabel,
  eventUserResult,
  progressSteps,
  safeSource,
  IMAGE_WITHOUT_VISION_LABEL,
  SPEC_ONLY_DESIGN_LABEL,
  studentProcessDone,
  studentTaskLabel,
  taskKeptSpecOnly,
  taskMissingSources,
  taskUnverifiedVision,
  visualProcessCaption,
  workingEvent,
} from "../lib/client/activity";
import {
  DESIGN_WITHOUT_PREVIEW,
  IMAGE_WITHOUT_VISION,
  RESEARCH_WITHOUT_SOURCES,
  type Task,
  type TaskEvent,
} from "../lib/contracts";
const event = (
  id: string,
  status: string,
  tool = "galley_research",
  call = "call-1",
) => ({ id, status, toolName: tool, toolCallId: call }) as TaskEvent;
const task = (state: Task["state"], events: TaskEvent[]) =>
  ({ state, events }) as Task;

test("visual progress requires actual active tool evidence", () => {
  assert.equal(workingEvent(task("running", [])), undefined);
  const start = event("start", "tool.running");
  assert.equal(workingEvent(task("running", [start])), start);
  for (const state of [
    "completed",
    "failed",
    "cancelled",
    "uncertain",
    "stopping",
    "waiting_user",
  ] as const)
    assert.equal(workingEvent(task(state, [start])), undefined);
  for (const state of ["completed", "failed", "cancelled", "uncertain"])
    assert.equal(
      workingEvent(task("running", [start, event("end", state)])),
      undefined,
    );
});
test("event states use concise user-facing labels", () => {
  for (const [status, label] of Object.entries({
    "tool.running": "執行中",
    queued: "排隊",
    waiting_authorization: "等待授權",
    waiting_user: "等待確認",
    completed: "完成",
    failed: "失敗",
    uncertain: "結果待確認",
    cancelled: "已取消",
    unexpected: "狀態未知",
  })) assert.equal(eventStateLabel(event("state", status)), label);
});
test("sequential and concurrent calls track IDs, not just tool names", () => {
  const first = event("1", "running"),
    second = event("2", "running", "galley_research", "call-2");
  assert.equal(
    workingEvent(
      task("running", [
        first,
        second,
        event("3", "completed", "galley_research", "call-2"),
      ]),
    ),
    first,
  );
  assert.equal(activityKind("galley_research"), "research");
  assert.equal(activityKind("canva_create_design"), "creative");
  assert.equal(activityKind("workspace_get_visual_concepts"), "creative");
  assert.equal(activityKind("planform_run_agent"), "creative");
  assert.equal(activityKind("unrecognized_tool"), "tool");
  assert.equal(eventPhaseLabel(event("g", "running")), "研究");
  assert.equal(
    eventPhaseLabel(event("c", "running", "canva_create_design")),
    "創作",
  );
  assert.equal(
    eventPhaseLabel(event("p", "running", "planform_run_agent")),
    "創作",
  );
  assert.equal(
    eventPhaseLabel(event("i", "running", "instagram_search")),
    "靈感",
  );
});
test("source actions never accept script, credentials or relative destinations", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//private",
    "https://user:secret@example.com",
    "file:///secret",
  ])
    assert.equal(safeSource(value), null);
  assert.equal(
    safeSource("https://example.com/source"),
    "https://example.com/source",
  );
});

test("plan phases collapse engineering steps into student-facing progress", () => {
  const planTask = task("running", [event("start", "tool.running")]) as Task;
  planTask.plan = {
    summary: "找靈感",
    budgetMode: "balanced",
    fallbacks: [],
    steps: [
      { id: "a", title: "讀取專案上下文", purpose: "", dependencies: [], agent: "general", tool: null, fallback: null, status: "pending" },
      { id: "b", title: "讀取共用記憶", purpose: "", dependencies: [], agent: "general", tool: null, fallback: null, status: "pending" },
      { id: "c", title: "查資料", purpose: "", dependencies: [], agent: "general", tool: "galley_research", fallback: null, status: "pending" },
      { id: "g", title: "研究情報", purpose: "", dependencies: [], agent: "general", tool: "galley_research", fallback: null, status: "pending" },
      { id: "d", title: "找靈感", purpose: "", dependencies: [], agent: "general", tool: null, fallback: null, status: "pending" },
      { id: "e", title: "Canva 接續", purpose: "", dependencies: [], agent: "general", tool: "canva_create_design", fallback: null, status: "pending" },
      { id: "studio", title: "創作台", purpose: "", dependencies: [], agent: "general", tool: "lumen_utter", fallback: null, status: "pending" },
      { id: "f", title: "最終審查", purpose: "", dependencies: [], agent: "general", tool: null, fallback: null, status: "pending" },
    ],
  };
  const steps = progressSteps(planTask);
  assert.deepEqual(
    steps.map((step) => step.label),
    ["理解", "研究", "靈感", "創作", "完成"],
  );
  const active = steps.find((step) => step.active);
  assert.equal(active?.label, "研究");
  assert.equal(steps[0]?.state, "completed");
});

test("progress without a plan still surfaces the live research tool", () => {
  const running = progressSteps(
    task("running", [event("start", "tool.running")]),
  );
  assert.equal(running[0]?.label, "研究");
  assert.equal(running[0]?.active, true);
});

test("tool JSON is technical, never the user-facing result", () => {
  assert.deepEqual(eventUserResult({ toolCallId: "call-9", schema: {} }), {
    text: null,
    technical: JSON.stringify({ toolCallId: "call-9", schema: {} }, null, 2),
  });
  assert.equal(eventUserResult("已找到三筆來源").text, "已找到三筆來源");
  assert.equal(eventUserResult("已找到三筆來源").technical, null);
  assert.equal(eventUserResult('{"ok":true}').text, null);
  assert.ok(eventUserResult('{"ok":true}').technical);
});

test("spec-only design completion is not painted as visual success", () => {
  const spec = task("completed", [
    event("research", "completed"),
    {
      ...event("spec", "completed", "workspace_get_visual_concepts", "call-spec"),
      summary: DESIGN_WITHOUT_PREVIEW,
    },
  ]);
  spec.goal = { requiresDesign: true } as Task["goal"];
  spec.plan = {
    summary: "做海報",
    budgetMode: "balanced",
    fallbacks: [],
    steps: [
      { id: "a", title: "讀取專案上下文", purpose: "", dependencies: [], agent: "general", tool: null, fallback: null, status: "completed" },
      { id: "c", title: "查資料", purpose: "", dependencies: [], agent: "general", tool: "galley_research", fallback: null, status: "completed" },
      { id: "e", title: "Canva 接續", purpose: "", dependencies: [], agent: "general", tool: "canva_create_design", fallback: null, status: "pending" },
      { id: "f", title: "最終審查", purpose: "", dependencies: [], agent: "general", tool: null, fallback: null, status: "pending" },
    ],
  };
  assert.equal(taskKeptSpecOnly(spec), true);
  assert.equal(studentTaskLabel(spec), SPEC_ONLY_DESIGN_LABEL);
  const steps = progressSteps(spec);
  assert.equal(steps.find((step) => step.label === "創作")?.state, "uncertain");
  assert.equal(steps.find((step) => step.label === "完成")?.state, "uncertain");
  assert.equal(studentProcessDone(spec, steps), false);
  assert.equal(visualProcessCaption(spec, steps), SPEC_ONLY_DESIGN_LABEL);
  const withPreview = task("completed", [
    {
      ...event("design", "completed", "canva_create_design"),
      result: {
        title: "茶會海報",
        thumbnail: { url: "https://www.canva.com/preview.png" },
      },
    },
  ]);
  assert.equal(taskKeptSpecOnly(withPreview), false);
  assert.equal(studentTaskLabel(withPreview), "完成");
  assert.equal(visualProcessCaption(withPreview), "過程完成");
});

test("research without https sources is not painted as found", () => {
  const missing = task("completed", [
    {
      ...event("research", "completed"),
      summary: RESEARCH_WITHOUT_SOURCES,
      sources: [],
    },
  ]);
  missing.goal = { requiresResearch: true, requiresTamkang: true } as Task["goal"];
  missing.plan = {
    summary: "查資料",
    budgetMode: "balanced",
    fallbacks: [],
    steps: [
      { id: "a", title: "讀取專案上下文", purpose: "", dependencies: [], agent: "general", tool: null, fallback: null, status: "completed" },
      { id: "c", title: "查資料", purpose: "", dependencies: [], agent: "general", tool: "galley_research", fallback: null, status: "completed" },
      { id: "d", title: "找靈感", purpose: "", dependencies: [], agent: "general", tool: null, fallback: null, status: "pending" },
    ],
  };
  assert.equal(taskMissingSources(missing), true);
  assert.equal(studentTaskLabel(missing), "還沒找到來源");
  const steps = progressSteps(missing);
  assert.equal(steps.find((step) => step.label === "研究")?.state, "uncertain");
  assert.equal(steps.find((step) => step.label === "靈感")?.state, "uncertain");
  assert.equal(studentProcessDone(missing, steps), false);
  assert.equal(visualProcessCaption(missing, steps), "還沒找到來源");
  const sourced = task("completed", [
    {
      ...event("research", "completed"),
      sources: ["https://www.tku.edu.tw/news"],
    },
  ]);
  assert.equal(taskMissingSources(sourced), false);
  assert.equal(studentTaskLabel(sourced), "完成");
  assert.equal(visualProcessCaption(sourced), "過程完成");
});

test("unverified vision is not painted as seen", () => {
  const unseen = task("completed", [
    {
      ...event("image", "completed", "ask_user", "call-image"),
      summary: IMAGE_WITHOUT_VISION,
    },
  ]);
  unseen.goal = { requiresImageAnalysis: true } as Task["goal"];
  unseen.plan = {
    summary: "看圖",
    budgetMode: "balanced",
    fallbacks: [],
    steps: [
      { id: "a", title: "讀取專案上下文", purpose: "", dependencies: [], agent: "general", tool: null, fallback: null, status: "completed" },
      { id: "img", title: "看圖", purpose: "", dependencies: [], agent: "general", tool: "ask_user", fallback: null, status: "pending" },
      { id: "f", title: "最終審查", purpose: "", dependencies: [], agent: "general", tool: null, fallback: null, status: "pending" },
    ],
  };
  assert.equal(taskUnverifiedVision(unseen), true);
  assert.equal(studentTaskLabel(unseen), IMAGE_WITHOUT_VISION_LABEL);
  const steps = progressSteps(unseen);
  assert.equal(steps.find((step) => step.label === "看圖")?.state, "uncertain");
  assert.equal(studentProcessDone(unseen, steps), false);
  assert.equal(visualProcessCaption(unseen, steps), IMAGE_WITHOUT_VISION_LABEL);
});

test("creative tasks attach Canva designs as conversation artifacts", () => {
  const creative = task("completed", [
    {
      ...event("design", "completed", "canva_create_design"),
      result: {
        design: {
          id: "dsn_1",
          title: "茶會海報",
          thumbnail: { url: "https://www.canva.com/preview.png" },
        },
      },
    },
  ]);
  const found = designsFromTask(creative);
  assert.equal(found[0]?.title, "茶會海報");
  const attached = artifactsForConversation(
    { ...creative, goal: { requiresDesign: true } } as Task,
    [
      {
        id: "wf-1",
        projectId: "personal",
        design: {
          id: "dsn_2",
          title: "專案草稿",
          urls: { edit_url: "https://www.canva.com/design/x/edit" },
        },
      },
    ],
    "personal",
  );
  assert.equal(attached.some((item) => item.id === "wf-1"), true);
  assert.equal(attached.some((item) => item.design.title === "茶會海報"), true);
  assert.equal(
    artifactsForConversation(
      task("completed", [event("lookup", "completed")]),
      [
        {
          id: "wf-1",
          projectId: "personal",
          design: {
            title: "舊稿",
            urls: { edit_url: "https://www.canva.com/design/x/edit" },
          },
        },
      ],
      "personal",
    ).length,
    0,
  );
  assert.equal(
    artifactsForConversation(
      {
        ...task("completed", [
          event("review", "completed", "workspace_simulate_audience"),
        ]),
        goal: { requiresDesign: true, requiresImageReview: true },
      } as Task,
      [
        {
          id: "wf-spec",
          projectId: "personal",
          design: { title: "舊規格" },
        },
      ],
      "personal",
    ).length,
    0,
  );
});
