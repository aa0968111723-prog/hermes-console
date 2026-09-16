import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../lib/server/security";
import {
  isTransientToolError,
  safeToRetry,
  withSafeRetry,
} from "../lib/server/retry";

test("only read tools retry transient 429/503 with backoff jitter", async () => {
  assert.equal(safeToRetry("workspace_read_material"), true);
  assert.equal(safeToRetry("galley_research"), true);
  assert.equal(safeToRetry("instagram_publish"), false);
  assert.equal(safeToRetry("delete_memory"), false);
  assert.equal(safeToRetry("canva_create_selected_draft"), false);
  assert.equal(
    isTransientToolError(new ApiError(429, "rate_limited", "slow")),
    true,
  );
  assert.equal(
    isTransientToolError(new ApiError(503, "galley_unconfigured", "missing")),
    false,
  );
  assert.equal(
    isTransientToolError(new ApiError(502, "empty_output", "empty")),
    false,
  );
  assert.equal(
    isTransientToolError(
      new ApiError(429, "tool_budget_exceeded", "budget"),
    ),
    false,
  );

  const waits: number[] = [];
  let calls = 0;
  const result = await withSafeRetry(
    async () => {
      calls += 1;
      if (calls < 3)
        throw new ApiError(429, "rate_limited", "slow");
      return { ok: true };
    },
    {
      toolName: "galley_research",
      clock: {
        wait: async (ms) => {
          waits.push(ms);
        },
        random: () => 0.5,
      },
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [250, 450]);

  let writeCalls = 0;
  await assert.rejects(
    () =>
      withSafeRetry(
        async () => {
          writeCalls += 1;
          throw new ApiError(429, "rate_limited", "slow");
        },
        { toolName: "instagram_publish" },
      ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "rate_limited",
  );
  assert.equal(writeCalls, 1);

  let emptyCalls = 0;
  await assert.rejects(
    () =>
      withSafeRetry(
        async () => {
          emptyCalls += 1;
          throw new ApiError(502, "empty_output", "empty");
        },
        { toolName: "workspace_read_material" },
      ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "empty_output",
  );
  assert.equal(emptyCalls, 1);
});
