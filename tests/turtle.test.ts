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
  assert.equal(turtleState(task("completed"), true).id, "error");
  assert.equal(turtleState(undefined, false).id, "idle");
});
