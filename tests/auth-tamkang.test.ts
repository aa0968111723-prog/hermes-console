import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-auth-tku-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3311";
process.env.CONSOLE_AUTH_MODE = "required";
delete process.env.TAMKANG_SSO_PROTOCOL;
delete process.env.TAMKANG_OIDC_ISSUER;
delete process.env.TAMKANG_CLIENT_ID;

const { TamkangAuthProvider } = await import(
  "../lib/server/auth/providers/tamkang"
);
const route = await import("../app/api/auth/tamkang/route");

test("Tamkang SSO stays unconfigured without official metadata", async () => {
  assert.equal(TamkangAuthProvider.isConfigured(), false);
  assert.equal(TamkangAuthProvider.unavailableMessage(), "淡江 SSO 尚未完成設定");
  assert.throws(() => TamkangAuthProvider.start(), /淡江 SSO 尚未完成設定/);
  const response = await route.GET(
    new Request("http://localhost:3311/api/auth/tamkang"),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.message, /淡江 SSO 尚未完成設定/);
  assert.equal(body.configured, false);
});
