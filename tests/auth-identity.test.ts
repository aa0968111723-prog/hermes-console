import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { seedSession } from "./session-fixture";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-auth-id-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3266";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.TAMKANG_SSO_CLIENT_ID;
delete process.env.RESEND_API_KEY;
delete process.env.CONSOLE_TEST_SESSION;

const { hashPassword, verifyPasswordHash, loginWithIdentity, registerEmail, loginEmail, linkEmailIdentity, users, identitiesFor } =
  await import("../lib/server/identity");
const auth = await import("../app/api/auth/route");
const google = await import("../app/api/auth/google/route");
const tamkang = await import("../app/api/auth/tamkang/route");
const artifacts = await import("../app/api/artifacts/route");

function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "",
) {
  return new Request("http://localhost:3266/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("password hashing, identity linking and unconfigured SSO", async (t) => {
  await t.test("Argon2id hashes verify and never store plaintext", () => {
    const encoded = hashPassword("Test-Password-14");
    assert.match(encoded, /^argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.equal(verifyPasswordHash("Test-Password-14", encoded), true);
    assert.equal(verifyPasswordHash("wrong-password-99", encoded), false);
    assert.doesNotMatch(encoded, /Test-Password-14/);
  });

  await t.test("Google and Tamkang stay unconfigured without metadata", async () => {
    assert.equal((await google.GET(request("auth/google"))).status, 503);
    assert.equal((await tamkang.GET(request("auth/tamkang"))).status, 503);
  });

  await t.test("first email owner and Google identity do not auto-merge by email", async () => {
    const registered = await registerEmail({
      email: "owner@example.test",
      password: "Test-Password-14",
      name: "擁有者",
    });
    assert.equal(registered.first, true);
    loginWithIdentity({
      provider: "google",
      providerId: "google-sub-separate",
      email: "owner@example.test",
      emailVerified: true,
      name: "Google 使用者",
    });
    assert.equal(users().length, 2);
    const owner = users().find((row) => row.email === "owner@example.test" && row.passwordHash);
    assert.ok(owner);
    assert.equal(identitiesFor(owner.id).some((row) => row.provider === "google"), false);
  });

  await t.test("explicit link attaches Google to the signed-in user", () => {
    const owner = users().find((row) => row.passwordHash)!;
    loginWithIdentity({
      provider: "google",
      providerId: "google-sub-owner",
      email: "owner-google@example.test",
      emailVerified: true,
      name: "擁有者",
      mode: "link",
      actorId: owner.id,
    });
    assert.equal(identitiesFor(owner.id).some((row) => row.provider === "google"), true);
  });

  await t.test("email link refuses another user's mailbox", () => {
    const owner = users().find((row) => row.passwordHash)!;
    const other = users().find((row) => row.id !== owner.id)!;
    assert.throws(
      () =>
        linkEmailIdentity(other.id, "owner@example.test", "Another-Password-14"),
      /不會因信箱相同而自動合併/,
    );
  });

  await t.test("logout clears the session cookie", async () => {
    const cookie = "hermes_session=" + loginEmail({
      email: "owner@example.test",
      password: "Test-Password-14",
    });
    const loggedOut = await auth.DELETE(request("auth", "DELETE", {}, cookie));
    assert.equal(loggedOut.status, 200);
    assert.match(loggedOut.headers.get("set-cookie") || "", /Max-Age=0/);
    assert.equal((await auth.GET(request("auth", "GET", undefined, cookie))).status, 401);
  });

  await t.test("artifact API requires a workspace session", async () => {
    assert.equal((await artifacts.GET(request("artifacts"))).status, 401);
    const { cookie } = seedSession();
    assert.equal((await artifacts.GET(request("artifacts", "GET", undefined, cookie))).status, 200);
    const forged = await artifacts.POST(
      request(
        "artifacts",
        "POST",
        {
          action: "fork",
          artifactId: randomUUID(),
          operationId: randomUUID(),
        },
        cookie,
      ),
    );
    assert.ok([403, 404].includes(forged.status));
  });
});
