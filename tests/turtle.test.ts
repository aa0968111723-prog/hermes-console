import test from "node:test";
import assert from "node:assert/strict";
import { turtleState } from "../components/Turtle";
import { DESIGN_WITHOUT_PREVIEW, IMAGE_WITHOUT_VISION, RESEARCH_WITHOUT_SOURCES, type Task, type TaskEvent } from "../lib/contracts";

function task(state: Task["state"], toolStatus?: string): Task {
  return {
    state,
    events: toolStatus
      ? [{ toolName: "Web_Search", status: toolStatus } as TaskEvent]
      : [],
  } as Task;
}

test("turtle only displays active tool work, not cancelled or uncertain events", () => {
  assert.equal(turtleState(task("running", "running"), false).id, "searching");
  for (const status of ["completed", "failed", "cancelled", "uncertain"])
    assert.equal(turtleState(task("running", status), false).id, "thinking");
  assert.equal(
    turtleState(task("running", "waiting_user"), false).id,
    "waiting",
  );
});

test("turtle terminal task and offline states override old tool activity", () => {
  assert.equal(
    turtleState(task("completed", "running"), false).id,
    "success",
  );
  assert.equal(
    turtleState(task("uncertain", "running"), false).label,
    "結果待確認",
  );
  assert.equal(turtleState(task("stopping", "running"), false).id, "waiting");
  assert.equal(turtleState(task("completed"), true).id, "offline");
  assert.equal(turtleState(undefined, false).id, "idle");
});

test("turtle does not celebrate a design task that kept only the spec", () => {
  const spec = {
    state: "completed",
    events: [
      {
        toolName: "workspace_get_visual_concepts",
        status: "completed",
        summary: DESIGN_WITHOUT_PREVIEW,
      },
    ],
  } as Task;
  assert.equal(turtleState(spec, false).id, "waiting");
  assert.equal(turtleState(spec, false).label, "規格已保留");
  assert.notEqual(turtleState(spec, false).id, "success");
  const finished = task("completed");
  assert.equal(turtleState(finished, false).id, "success");
  assert.equal(turtleState(finished, false).label, "完成了");
});

test("turtle does not celebrate research that found no sources", () => {
  const missing = {
    state: "completed",
    events: [
      {
        toolName: "galley_research",
        status: "completed",
        summary: RESEARCH_WITHOUT_SOURCES,
      },
    ],
  } as Task;
  assert.equal(turtleState(missing, false).id, "waiting");
  assert.equal(turtleState(missing, false).label, "還沒找到來源");
});

test("turtle does not celebrate unverified vision as seen", () => {
  const unseen = {
    state: "completed",
    events: [
      {
        toolName: "ask_user",
        status: "completed",
        summary: IMAGE_WITHOUT_VISION,
      },
    ],
  } as Task;
  assert.equal(turtleState(unseen, false).id, "waiting");
  assert.equal(turtleState(unseen, false).label, "還沒看圖");
});

test("turtle student labels never name vendors or tools", () => {
  const galley = {
    state: "running",
    events: [{ toolName: "galley_research", status: "running" }],
  } as Task;
  const canva = {
    state: "running",
    events: [{ toolName: "canva_create_design", status: "running" }],
  } as Task;
  const twin = {
    state: "running",
    events: [{ toolName: "audience_twin", status: "running" }],
  } as Task;
  assert.equal(turtleState(galley, false).id, "researching");
  assert.equal(turtleState(galley, false).label, "正在研究");
  assert.equal(turtleState(canva, false).id, "creating");
  assert.equal(turtleState(canva, false).label, "正在創作");
  assert.equal(turtleState(twin, false).id, "thinking");
  for (const row of [galley, canva, twin]) {
    const label = turtleState(row, false).label;
    assert.doesNotMatch(label, /GALLEY|Canva|Audience|toolCall|MCP/i);
  }
});
