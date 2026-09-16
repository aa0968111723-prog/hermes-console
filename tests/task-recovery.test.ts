import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { seedSession } from "./session-fixture";

const dataDir = await mkdtemp(join(tmpdir(), "hermes-recovery-"));
process.env.CONSOLE_DATA_DIR = dataDir;
process.env.CONSOLE_ORIGIN = "http://localhost:3268";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;

const { put, get } = await import("../lib/server/store");
const { recoverOrphanedTasks } = await import("../lib/server/monitor");
const { EMPTY_USAGE } = await import("../lib/contracts");
import type { Task } from "../lib/contracts";

function runningChatTask(id = randomUUID()): Task {
  return {
    id,
    conversationId: randomUUID(),
    requestKey: randomUUID(),
    payloadHash: "orphan-fixture",
    state: "running",
    transport: "chat",
    remoteId: null,
    input: "幫我找淡大禪學社茶會宣傳靈感",
    attachments: [],
    output: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: null,
    error: null,
    observationError: null,
    events: [],
    usage: { ...EMPTY_USAGE },
    stopSupported: false,
  };
}

test("restart recovery marks orphaned chat tasks uncertain without resending", async () => {
  seedSession();
  const task = runningChatTask();
  put("task", "workspace", task);
  await recoverOrphanedTasks();
  const recovered = get<Task>("task", "workspace", task.id);
  assert.equal(recovered?.state, "uncertain");
  assert.match(recovered?.error || "", /不會自動重送/);
  assert.equal(recovered?.payloadHash, "orphan-fixture");
  assert.equal(recovered?.requestKey, task.requestKey);
  assert.equal(recovered?.input, task.input);
});

test("completed tasks are left alone during recovery", async () => {
  const task = {
    ...runningChatTask(),
    state: "completed" as const,
    output: "已完成",
    endedAt: new Date().toISOString(),
  };
  put("task", "workspace", task);
  await recoverOrphanedTasks();
  const stored = get<Task>("task", "workspace", task.id);
  assert.equal(stored?.state, "completed");
  assert.equal(stored?.output, "已完成");
  assert.equal(stored?.error, null);
});
