import test from "node:test";
import assert from "node:assert/strict";
import {
  isEmptyToolResult,
  taxonomyFor,
} from "../lib/server/errors";

test("empty tool payloads are not success", () => {
  for (const value of [null, undefined, "", "  ", [], {}, { content: [] }, { result: null }])
    assert.equal(isEmptyToolResult(value), true, String(value));
  assert.equal(isEmptyToolResult({ items: [] }), false);
  assert.equal(isEmptyToolResult({ title: "茶會" }), false);
  assert.equal(isEmptyToolResult("已找到三筆來源"), false);
});

test("error codes collapse into the shared taxonomy", () => {
  assert.equal(taxonomyFor("empty_tool_result"), "TOOL_UNAVAILABLE");
  assert.equal(taxonomyFor("invalid_login"), "AUTH_ERROR");
  assert.equal(taxonomyFor("permission_denied"), "PERMISSION_ERROR");
  assert.equal(taxonomyFor("membership_required"), "PERMISSION_ERROR");
  assert.equal(taxonomyFor("rate_limited"), "RATE_LIMIT");
  assert.equal(taxonomyFor("store_unavailable"), "NETWORK_ERROR");
  assert.equal(taxonomyFor("mystery"), "UNKNOWN");
});
