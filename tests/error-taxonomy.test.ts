import test from "node:test";
import assert from "node:assert/strict";
import { ERROR_CATEGORIES, errorCategory } from "../lib/server/errors";

test("tool and auth failures map onto the shared error taxonomy", () => {
  assert.deepEqual(ERROR_CATEGORIES, [
    "AUTH_ERROR",
    "PERMISSION_ERROR",
    "TOOL_UNAVAILABLE",
    "TOOL_TIMEOUT",
    "RATE_LIMIT",
    "INVALID_INPUT",
    "NETWORK_ERROR",
    "UPSTREAM_ERROR",
    "UNKNOWN",
  ]);
  assert.equal(errorCategory("empty_output"), "UPSTREAM_ERROR");
  assert.equal(errorCategory("empty_stream"), "UPSTREAM_ERROR");
  assert.equal(errorCategory("galley_empty"), "UPSTREAM_ERROR");
  assert.equal(errorCategory("lumen_unconfigured"), "TOOL_UNAVAILABLE");
  assert.equal(errorCategory("hermes_not_ready"), "TOOL_UNAVAILABLE");
  assert.equal(errorCategory("unknown_tool"), "TOOL_UNAVAILABLE");
  assert.equal(errorCategory("tool_budget_exceeded"), "RATE_LIMIT");
  assert.equal(errorCategory("tool_timeout"), "TOOL_TIMEOUT");
  assert.equal(errorCategory("AUTH_ERROR"), "AUTH_ERROR");
  assert.equal(errorCategory("ssrf_rejected"), "NETWORK_ERROR");
  assert.equal(errorCategory("invalid_json"), "INVALID_INPUT");
  assert.equal(errorCategory("not_a_real_code"), "UNKNOWN");
});
