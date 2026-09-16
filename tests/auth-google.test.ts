import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-auth-google-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3312";
process.env.CONSOLE_AUTH_MODE = "required";
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

const { startGoogleAuth } = await import("../lib/server/auth/providers/google");
const { googleConfigured } = await import("../lib/server/auth/mode");

test("Google login does not fake success when secrets are missing", () => {
  assert.equal(googleConfigured(), false);
  assert.throws(() => startGoogleAuth(), /Google 登入尚未完成設定/);
});

test("Google authorization code start uses PKCE when configured", async () => {
  process.env.GOOGLE_CLIENT_ID = "test-google-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
  const { startGoogleAuth: start } = await import(
    "../lib/server/auth/providers/google"
  );
  const url = new URL(start());
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge"));
  assert.ok(url.searchParams.get("state"));
  assert.ok(!url.href.includes("test-google-secret"));
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});
