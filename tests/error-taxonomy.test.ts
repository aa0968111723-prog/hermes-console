import test from "node:test";
import assert from "node:assert/strict";
import { errorCategory } from "../lib/server/errors";
import { membershipLabel } from "../lib/client/membership";

test("API errors map onto the nine shared categories", () => {
  assert.equal(errorCategory("google_unconfigured"), "AUTH_ERROR");
  assert.equal(errorCategory("tamkang_unconfigured"), "AUTH_ERROR");
  assert.equal(errorCategory("tku_password_refused"), "AUTH_ERROR");
  assert.equal(errorCategory("invalid_login"), "AUTH_ERROR");
  assert.equal(errorCategory("workspace_forbidden"), "PERMISSION_ERROR");
  assert.equal(errorCategory("identity_conflict"), "PERMISSION_ERROR");
  assert.equal(errorCategory("galley_unconfigured"), "TOOL_UNAVAILABLE");
  assert.equal(errorCategory("lumen_token_missing"), "TOOL_UNAVAILABLE");
  assert.equal(errorCategory("hermes_not_ready"), "TOOL_UNAVAILABLE");
  assert.equal(errorCategory("idle_timeout"), "TOOL_TIMEOUT");
  assert.equal(errorCategory("tool_timeout"), "TOOL_TIMEOUT");
  assert.equal(errorCategory("rate_limited"), "RATE_LIMIT");
  assert.equal(errorCategory("invalid_input"), "INVALID_INPUT");
  assert.equal(errorCategory("github_is_not_mcp"), "INVALID_INPUT");
  assert.equal(errorCategory("project_not_found"), "INVALID_INPUT");
  assert.equal(errorCategory("store_unavailable"), "NETWORK_ERROR");
  assert.equal(errorCategory("empty_output"), "UPSTREAM_ERROR");
  assert.equal(errorCategory("galley_empty"), "UPSTREAM_ERROR");
  assert.equal(errorCategory("internal_error"), "UNKNOWN");
  assert.equal(errorCategory("brand_new_code"), "UNKNOWN");
});

test("membership labels stay Traditional Chinese for students", () => {
  assert.equal(membershipLabel("owner"), "擁有者");
  assert.equal(membershipLabel("admin"), "管理員");
  assert.equal(membershipLabel("member"), "成員");
  assert.equal(membershipLabel(null), "尚未加入");
});
