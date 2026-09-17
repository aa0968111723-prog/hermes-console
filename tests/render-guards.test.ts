import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isCreativeTask,
  progressSteps,
  studentTaskCaption,
  taskEvents,
  taskHasWorkspaceResult,
  workingEvent,
} from "../lib/client/activity";
import { layoutFromTask } from "../lib/client/planform-layout";
import { turtleState } from "../components/Turtle";
import type { Task } from "../lib/contracts";

const incomplete = { state: "running", events: undefined } as unknown as Task;
const nulled = { state: "running", events: null } as unknown as Task;

test("missing task.events does not throw in activity helpers", () => {
  for (const task of [incomplete, nulled]) {
    assert.deepEqual(taskEvents(task), []);
    assert.equal(workingEvent(task), undefined);
    assert.deepEqual(progressSteps(task), []);
    assert.equal(studentTaskCaption(task), "查看任務進度");
    assert.equal(isCreativeTask(task), false);
    assert.equal(taskHasWorkspaceResult(task), false);
    assert.equal(layoutFromTask(task), null);
    assert.doesNotThrow(() => turtleState(task, false));
  }
});

test("activity.ts routes events through taskEvents and does not call .some on missing arrays", async () => {
  const activity = await readFile(
    new URL("../lib/client/activity.ts", import.meta.url),
    "utf8",
  );
  assert.match(activity, /function taskEvents/);
  assert.doesNotMatch(activity, /task\?\.events\.some/);
  assert.match(
    activity,
    /return Array\.isArray\(task\?\.events\) \? task\.events : \[\];/,
  );
  assert.doesNotMatch(
    activity,
    /return Array\.isArray\(task\?\.events\) \? taskEvents\(task\)/,
  );
});

test("runtime-stream emits an immediate first byte and heartbeats while sync is inflight", async () => {
  const source = await readFile(
    new URL("../lib/server/hermes/runtime-stream.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /: connected\\n\\n/);
  assert.match(source, /snapshotHash: null/);
  assert.match(source, /if \(\(controller\.desiredSize \?\? 0\) <= 0\) return;/);
  assert.doesNotMatch(
    source,
    /if \(runtimeSyncInflight\(owner\) \|\| \(controller\.desiredSize \?\? 0\) <= 0\)/,
  );
});

test("workspace load and VisualMessage keep arrays before render", async () => {
  const consoleSource = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  assert.match(consoleSource, /function asWorkspace/);
  assert.match(consoleSource, /setData\(asWorkspace\(/);
  assert.match(
    consoleSource,
    /Array\.isArray\(taskResult\.tasks\) \? taskResult\.tasks : \[\]/,
  );
  const visual = await readFile(
    new URL("../components/visual/VisualMessage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(visual, /const taskView = \{ \.\.\.task, events \}/);
  assert.doesNotMatch(visual, /task\.events\.flatMap/);
  assert.doesNotMatch(visual, /task\.events\.map/);
});
