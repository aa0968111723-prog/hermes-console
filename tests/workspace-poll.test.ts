import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_POLL_MS,
  HIDDEN_POLL_MS,
  IDLE_POLL_MS,
  workspacePollDelay,
} from "../lib/client/poll";

test("workspace poll backs off when idle or hidden", () => {
  assert.equal(workspacePollDelay(false, true), ACTIVE_POLL_MS);
  assert.equal(workspacePollDelay(false, false), IDLE_POLL_MS);
  assert.equal(workspacePollDelay(true, true), HIDDEN_POLL_MS);
  assert.equal(workspacePollDelay(true, false), HIDDEN_POLL_MS);
  assert.ok(IDLE_POLL_MS > ACTIVE_POLL_MS);
  assert.ok(HIDDEN_POLL_MS > IDLE_POLL_MS);
});
