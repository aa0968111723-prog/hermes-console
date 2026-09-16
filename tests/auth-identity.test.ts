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

const { hashPassword, verifyPasswordHash, loginWithIdentity, registerEmail, loginEmail, linkEmailIdentity, users, identitiesFor, verifyEmail, boundLinkActor } =
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

  await t.test("OAuth link stays on the original session", async () => {
    assert.equal(boundLinkActor("login", "a", "b"), undefined);
    assert.equal(boundLinkActor("link", "user-1", "user-1"), "user-1");
    assert.throws(
      () => boundLinkActor("link", "user-1", "user-2"),
      /原本的登入工作階段/,
    );
    assert.throws(
      () => boundLinkActor("link", "user-1", undefined),
      /原本的登入工作階段/,
    );
    assert.equal(
      (await google.GET(request("auth/google?mode=link"))).status,
      401,
    );
    assert.equal(
      (await tamkang.GET(request("auth/tamkang?mode=link"))).status,
      401,
    );
    process.env.GOOGLE_CLIENT_ID = "test.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "test-google-secret-not-for-production";
    try {
      assert.equal(
        (await google.GET(request("auth/google?mode=link"))).status,
        401,
      );
      const login = await google.GET(request("auth/google"));
      assert.equal(login.status, 302);
      const location = login.headers.get("location") || "";
      assert.match(location, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
      assert.doesNotMatch(location, /test-google-secret|client_secret/);
      const owner = users().find((row) => row.passwordHash)!;
      const cookie =
        "hermes_session=" +
        loginEmail({
          email: "owner@example.test",
          password: "Test-Password-14",
        });
      const linked = await google.GET(
        request("auth/google?mode=link", "GET", undefined, cookie),
      );
      assert.equal(linked.status, 302);
      const linkLocation = linked.headers.get("location") || "";
      assert.match(linkLocation, /accounts\.google\.com/);
      assert.match(linkLocation, /state=/);
      assert.doesNotMatch(linkLocation, /test-google-secret|client_secret/);
      assert.equal(identitiesFor(owner.id).some((row) => row.provider === "google"), true);
    } finally {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
    }
  });

  await t.test("email link refuses another user's mailbox", async () => {
    const owner = users().find((row) => row.passwordHash)!;
    const other = users().find((row) => row.id !== owner.id)!;
    assert.throws(
      () =>
        linkEmailIdentity(other.id, "owner@example.test", "Another-Password-14"),
      /不會因信箱相同而自動合併/,
    );
  });

  await t.test("email link stays honest without mail and verifies before password login", async () => {
    const googleToken = loginWithIdentity({
      provider: "google",
      providerId: "google-sub-link-mail",
      email: "link-mail@example.test",
      emailVerified: true,
      name: "連結信箱",
    });
    assert.match(googleToken, /^[a-f0-9]{64}$/);
    const googleUser = users().find((row) =>
      identitiesFor(row.id).some((row) => row.providerId === "google-sub-link-mail"),
    )!;
    assert.throws(
      () =>
        linkEmailIdentity(
          googleUser.id,
          "linked-pass@example.test",
          "Linked-Password-14",
        ),
      /尚未設定寄件/,
    );
    process.env.RESEND_API_KEY = "test-resend-not-for-production-use";
    process.env.CONSOLE_EMAIL_FROM = "console@example.test";
    const emails: Array<{ text: string }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url) === "https://api.resend.com/emails") {
        emails.push(JSON.parse(String(init?.body)));
        return Response.json({ id: "link-mail" });
      }
      return original(url as never, init);
    };
    try {
      const linked = await linkEmailIdentity(
        googleUser.id,
        "linked-pass@example.test",
        "Linked-Password-14",
      );
      assert.equal(linked.verificationSent, true);
      assert.equal(emails.length, 1);
      assert.throws(
        () =>
          loginEmail({
            email: "linked-pass@example.test",
            password: "Linked-Password-14",
          }),
        /請先完成電子信箱驗證/,
      );
      const verifyToken = emails[0].text.match(/#verify=([a-f0-9]{64})/)![1];
      verifyEmail(verifyToken);
      const session = loginEmail({
        email: "linked-pass@example.test",
        password: "Linked-Password-14",
      });
      assert.match(session, /^[a-f0-9]{64}$/);
    } finally {
      globalThis.fetch = original;
      delete process.env.RESEND_API_KEY;
      delete process.env.CONSOLE_EMAIL_FROM;
    }
  });

  await t.test("revoke others keeps the current session", async () => {
    const probe = loginEmail({
      email: "owner@example.test",
      password: "Test-Password-14",
    });
    await auth.POST(
      request("auth", "POST", { action: "revoke_others" }, "hermes_session=" + probe),
    );
    const other = loginEmail({
      email: "owner@example.test",
      password: "Test-Password-14",
    });
    const listed = await (
      await auth.GET(request("auth", "GET", undefined, "hermes_session=" + other))
    ).json();
    assert.equal(listed.sessions.length, 2);
    assert.equal(
      listed.sessions.filter((row: { current: boolean }) => row.current).length,
      1,
    );
    const current = listed.sessions.find((row: { current: boolean }) => row.current);
    assert.equal(current.id.length, 64);
    const blocked = await auth.POST(
      request(
        "auth",
        "POST",
        { action: "revoke_session", sessionId: current.id },
        "hermes_session=" + other,
      ),
    );
    assert.equal(blocked.status, 400);
    const revoked = await auth.POST(
      request("auth", "POST", { action: "revoke_others" }, "hermes_session=" + other),
    );
    assert.equal(revoked.status, 200);
    assert.equal(
      (await auth.GET(request("auth", "GET", undefined, "hermes_session=" + probe)))
        .status,
      401,
    );
    const remaining = await (
      await auth.GET(request("auth", "GET", undefined, "hermes_session=" + other))
    ).json();
    assert.equal(remaining.sessions.length, 1);
    assert.equal(remaining.sessions[0].current, true);
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
