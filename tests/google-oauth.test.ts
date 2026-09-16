import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-google-oauth-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3241";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.GOOGLE_CLIENT_ID = "google-contract-client";
process.env.GOOGLE_CLIENT_SECRET = randomBytes(24).toString("hex");

const { startGoogle, finishGoogle } = await import("../lib/server/auth/google");
const { identitiesFor, getUser } = await import("../lib/server/auth/identity");

test("Google authorization code + PKCE does not put secrets in the redirect", () => {
  const url = startGoogle("login");
  assert.match(url, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  assert.match(url, /response_type=code/);
  assert.match(url, /code_challenge=/);
  assert.match(url, /code_challenge_method=S256/);
  assert.doesNotMatch(url, /client_secret/);
  assert.doesNotMatch(url, new RegExp(process.env.GOOGLE_CLIENT_SECRET || "missing"));
});

test("mocked Google token exchange issues a session for one user", async () => {
  const start = new URL(startGoogle("login"));
  const state = start.searchParams.get("state") || "";
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const href = String(input);
    if (href.includes("oauth2.googleapis.com/token")) {
      const body = String(init?.body || "");
      assert.match(body, /grant_type=authorization_code/);
      assert.match(body, /code_verifier=/);
      assert.doesNotMatch(body, /ya29\./);
      return Response.json({ access_token: "ya29.fixture-access" });
    }
    if (href.includes("openidconnect.googleapis.com")) {
      return Response.json({
        sub: "google-sub-contract-1",
        email: "google.user@example.test",
        email_verified: true,
        name: "Google User",
        picture: "https://example.test/avatar.png",
      });
    }
    throw new Error("unexpected fetch");
  };
  try {
    const result = await finishGoogle(
      new Request(
        "http://localhost:3241/api/auth/google/callback?code=fixture-code&state=" +
          state,
      ),
    );
    assert.ok(result.token);
    assert.match(result.token || "", /^[a-f0-9]{64}$/);
    const user = getUser(result.userId);
    assert.equal(user?.email, "google.user@example.test");
    assert.ok(identitiesFor(result.userId).some((item) => item.provider === "google"));
  } finally {
    globalThis.fetch = original;
  }
});

test("invalid Google state does not pretend success", async () => {
  await assert.rejects(
    () =>
      finishGoogle(
        new Request(
          "http://localhost:3241/api/auth/google/callback?code=x&state=deadbeef",
        ),
      ),
    /過期|未完成/,
  );
});

test("connection settings do not collect school passwords", async () => {
  const source = await readFile(
    join(process.cwd(), "components/settings/ConnectionSettings.tsx"),
    "utf8",
  );
  assert.equal(source.includes("淡江密碼"), false);
  assert.equal(source.includes("校園憑證"), false);
  assert.match(source, /不收集學校密碼/);
});
