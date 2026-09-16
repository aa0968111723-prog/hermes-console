import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Task } from "../lib/contracts";
import { EMPTY_USAGE } from "../lib/contracts";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-resume-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3318";

const { put } = await import("../lib/server/store");
const { WORKSPACE_OWNER } = await import("../lib/server/security");
const { recoverInterruptedTasks, taskFor } = await import(
  "../lib/server/tasks"
);

test("restarted chat tasks become uncertain instead of still running", async () => {
  const id = randomUUID();
  put("task", WORKSPACE_OWNER, {
    id,
    conversationId: randomUUID(),
    requestKey: randomUUID(),
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
    events: [],
    usage: { ...EMPTY_USAGE },
    stopSupported: false,
  } satisfies Task);
  await recoverInterruptedTasks();
  const recovered = taskFor(WORKSPACE_OWNER, id);
  assert.equal(recovered.state, "uncertain");
  assert.match(recovered.error || "", /不會自動重送/);
});
