import test from "node:test";
import assert from "node:assert/strict";
import { turtleState } from "../components/Turtle";
import type { Task, TaskEvent } from "../lib/contracts";

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

test("turtle maps planner, research, create, tool, wait, error, and offline", () => {
  assert.equal(turtleState(undefined, false).id, "idle");
  assert.equal(
    turtleState(
      {
        ...task("queued"),
        plan: { summary: "", budgetMode: "balanced", steps: [{} as never], fallbacks: [] },
      } as Task,
      false,
    ).id,
    "planning",
  );
  assert.equal(
    turtleState(
      {
        ...task("running"),
        events: [{ toolName: "galley_research", status: "running" } as TaskEvent],
      },
      false,
    ).id,
    "researching",
  );
  assert.equal(
    turtleState(
      {
        ...task("running"),
        events: [{ toolName: "canva_create", status: "running" } as TaskEvent],
      },
      false,
    ).id,
    "creating",
  );
  assert.equal(
    turtleState(
      {
        ...task("running"),
        events: [{ toolName: "workspace_read_material", status: "running" } as TaskEvent],
      },
      false,
    ).label,
    "正在看圖",
  );
  assert.equal(turtleState(task("waiting_user"), false).id, "waiting");
  assert.equal(turtleState(task("failed"), false).id, "error");
  assert.equal(turtleState(task("running"), true).id, "offline");
});
