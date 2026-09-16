import test from "node:test";
import assert from "node:assert/strict";
import { errorCategory } from "../lib/server/errors";

test("error taxonomy maps auth, tool, and unconfigured codes", () => {
  assert.equal(errorCategory("auth_unconfigured"), "AUTH_ERROR");
  assert.equal(errorCategory("sign_in_required"), "AUTH_ERROR");
  assert.equal(errorCategory("current_session"), "AUTH_ERROR");
  assert.equal(errorCategory("session_not_found"), "AUTH_ERROR");
  assert.equal(errorCategory("membership_required"), "PERMISSION_ERROR");
  assert.equal(errorCategory("hermes_unconfigured"), "TOOL_UNAVAILABLE");
  assert.equal(errorCategory("hermes_not_ready"), "TOOL_UNAVAILABLE");
  assert.equal(errorCategory("canva_unconfigured"), "TOOL_UNAVAILABLE");
  assert.equal(errorCategory("galley_unconfigured"), "TOOL_UNAVAILABLE");
  assert.equal(errorCategory("atlas_unconfigured"), "TOOL_UNAVAILABLE");
  assert.equal(errorCategory("zeabur_unconfigured"), "TOOL_UNAVAILABLE");
  assert.equal(errorCategory("tool_timeout"), "TOOL_TIMEOUT");
  assert.equal(errorCategory("rate_limited"), "RATE_LIMIT");
  assert.equal(errorCategory("invalid_input"), "INVALID_INPUT");
  assert.equal(errorCategory("network_error"), "NETWORK_ERROR");
  assert.equal(errorCategory("upstream_502"), "UPSTREAM_ERROR");
  assert.equal(errorCategory("empty_tool_result"), "UPSTREAM_ERROR");
  assert.equal(errorCategory("empty_output"), "UPSTREAM_ERROR");
  assert.equal(errorCategory("images_unverified"), "TOOL_UNAVAILABLE");
  assert.equal(errorCategory("mystery_code"), "UNKNOWN");
});
