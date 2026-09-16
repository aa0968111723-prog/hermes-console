import test from "node:test";
import assert from "node:assert/strict";
import type { DirectionBriefPack } from "../lib/direction-brief";
import type { Workflow } from "../lib/server/workflows";
import { isDirectionBriefPack } from "../lib/direction-brief";
import {
  applyDirectionBriefFromTask,
  hasDirectionSpec,
  mergeWorkflows,
  readDirectionBriefFromTask,
  readSelectedDirectionWorkflow,
  upsertWorkflow,
  workflowPreviewDesign,
} from "../lib/client/workflow-state";

const pack = (): DirectionBriefPack => ({
  kind: "direction_brief",
  selected: "A",
  title: "茶會",
  summary: "規格草稿",
  hermesGenerated: false,
  rendered: false,
  generatedImage: false,
  publish: false,
  formats: [
    {
      id: "ig_feed_4x5",
      label: "貼文",
      aspect: "4:5",
      width: 1080,
      height: 1350,
      compositionHint: "置中主標。",
    },
  ],
  copy: { a: "最自然", b: "最有梗", c: "最溫暖" },
  review: {} as DirectionBriefPack["review"],
  notice: "規則草稿，不是已出圖。不是 Hermes 生成。",
  copyId: "copy-1",
});

test("select POST body becomes a chat workflow without waiting on GET", () => {
  const slim = {
    id: "wf-select",
    state: "draft_ready" as const,
    selected: 0,
    directionBrief: pack(),
  };
  const workflow = readSelectedDirectionWorkflow(slim, {
    projectId: "personal",
    conversationId: "conv-1",
  });
  assert.ok(workflow);
  assert.equal(workflow.projectId, "personal");
  assert.equal(workflow.conversationId, "conv-1");
  assert.equal(workflow.directionBrief?.selected, "A");
  assert.equal(workflow.directionBrief?.rendered, false);
  assert.equal(readSelectedDirectionWorkflow({ id: "wf" }, { projectId: "personal" }), null);
  assert.equal(readSelectedDirectionWorkflow(null, { projectId: "personal" }), null);
});

test("select POST can recover the brief from the top-level field", () => {
  const workflow = readSelectedDirectionWorkflow(
    { id: "wf-brief" },
    { projectId: "personal", conversationId: "conv-1", brief: pack() },
  );
  assert.ok(workflow);
  assert.equal(workflow.directionBrief?.title, "茶會");
});

test("empty or stale workflow GET keeps the local spec", () => {
  const local: Workflow = {
    id: "wf-select",
    projectId: "personal",
    brief: "規格草稿",
    directions: [],
    selected: 0,
    state: "draft_ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    canvaJobId: null,
    design: null,
    error: null,
    directionBrief: pack(),
    conversationId: "conv-1",
  };
  assert.equal(mergeWorkflows([local], []).length, 1);
  assert.equal(mergeWorkflows([local], "nope").length, 1);
  const dropped = mergeWorkflows([local], [
    { id: "other", projectId: "personal", brief: "", directions: [], selected: null, state: "failed", createdAt: "", updatedAt: "", canvaJobId: null, design: null, error: null },
  ]);
  assert.ok(dropped.some((item) => item.id === "wf-select"));
  const stripped = mergeWorkflows([local], [{ ...local, directionBrief: null }]);
  assert.equal(stripped.find((item) => item.id === "wf-select")?.directionBrief?.selected, "A");
  const staleV1 = mergeWorkflows(
    [{ ...local, directionBrief: { ...pack(), revision: 2, visualNote: "配色偏暖。規則修訂，不是出圖。" }, updatedAt: "2026-01-01T00:00:05.000Z" }],
    [{ ...local, directionBrief: { ...pack(), revision: 1 }, updatedAt: "2026-01-01T00:00:06.000Z" }],
  );
  assert.equal(staleV1[0].directionBrief?.revision, 2);
  assert.match(staleV1[0].directionBrief?.visualNote || "", /配色偏暖/);
  const upserted = upsertWorkflow([], local);
  assert.equal(upserted[0].id, "wf-select");
  assert.equal(upsertWorkflow(upserted, { ...local, updatedAt: "later" })[0].updatedAt, "later");
});

test("task POST events update the trailing spec without waiting on GET", () => {
  const local: Workflow = {
    id: "wf-select",
    projectId: "personal",
    brief: "規格草稿",
    directions: [],
    selected: 0,
    state: "draft_ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    canvaJobId: null,
    design: null,
    error: null,
    directionBrief: { ...pack(), revision: 1 },
    conversationId: "conv-1",
  };
  const warmer = {
    ...pack(),
    revision: 2,
    visualNote: "配色偏暖。規則修訂，不是出圖。",
  };
  const task = {
    conversationId: "conv-1",
    updatedAt: "2026-01-01T00:00:08.000Z",
    endedAt: "2026-01-01T00:00:08.000Z",
    events: [
      {
        id: "e1",
        taskId: "t1",
        toolName: "workspace_revise_direction_spec",
        status: "completed",
        startedAt: "2026-01-01T00:00:08.000Z",
        endedAt: "2026-01-01T00:00:08.000Z",
        summary: "配色偏暖",
        result: warmer,
        sources: [],
        error: null,
        usage: null,
      },
    ],
  };
  assert.equal(readDirectionBriefFromTask(task)?.revision, 2);
  const applied = applyDirectionBriefFromTask(
    [{ ...local, design: { ...pack(), revision: 1 } }],
    task,
  );
  assert.equal(applied[0].directionBrief?.revision, 2);
  assert.equal(
    isDirectionBriefPack(applied[0].design) ? applied[0].design.revision : 0,
    2,
  );
  assert.match(applied[0].directionBrief?.visualNote || "", /配色偏暖/);
  const preview = workflowPreviewDesign(applied[0]);
  assert.equal(isDirectionBriefPack(preview) ? preview.revision : 0, 2);
  const staleDesign = mergeWorkflows(applied, [
    {
      ...local,
      design: { ...pack(), revision: 1 },
      directionBrief: { ...pack(), revision: 1 },
      updatedAt: "2026-01-01T00:00:09.000Z",
    },
  ]);
  assert.equal(staleDesign[0].directionBrief?.revision, 2);
  assert.equal(
    isDirectionBriefPack(workflowPreviewDesign(staleDesign[0]))
      ? workflowPreviewDesign(staleDesign[0])!.revision
      : 0,
    2,
  );
  const continueTask = {
    ...task,
    events: [
      {
        ...task.events[0],
        toolName: "workspace_continue_direction_spec",
        result: { ...pack(), revision: 1, rendered: false },
      },
    ],
  };
  const kept = applyDirectionBriefFromTask(applied, continueTask);
  assert.equal(kept[0].directionBrief?.revision, 2);
  assert.equal(hasDirectionSpec(applied), true);
  assert.equal(hasDirectionSpec([]), false);
  assert.equal(applyDirectionBriefFromTask([], task).length, 0);
});
