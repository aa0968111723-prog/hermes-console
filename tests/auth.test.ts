import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-auth-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3310";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
process.env.CONSOLE_WORKSPACE_JOIN = "open";
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.TAMKANG_SSO_CLIENT_ID;
delete process.env.TAMKANG_SSO_CLIENT_SECRET;
delete process.env.TAMKANG_SSO_ISSUER;
delete process.env.RESEND_API_KEY;

const { hashPassword, verifyPasswordHash } = await import("../lib/server/passwords");
const identity = await import("../lib/server/identity");
const emailAuth = await import("../lib/server/auth-email");
const { tamkangAuthStatus, tamkangStart } = await import("../lib/server/auth-tamkang");
const { googleStart } = await import("../lib/server/auth-google");
const { authenticate, ApiError } = await import("../lib/server/security");
const sessionRoute = await import("../app/api/auth/session/route");
const emailRoute = await import("../app/api/auth/email/route");
const workspace = await import("../app/api/workspace/route");
const healthRoute = await import("../app/api/health/route");

function request(path: string, method = "GET", body?: unknown, cookie = "") {
  return new Request("http://localhost:3310/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3310",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("Argon2id password hashes verify and reject wrong secrets", () => {
  const encoded = hashPassword("correct-horse-battery");
  assert.match(encoded, /^argon2id:[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(verifyPasswordHash("correct-horse-battery", encoded), true);
  assert.equal(verifyPasswordHash("wrong-password-12", encoded), false);
});

test("unconfigured providers stay honest", async () => {
  const tamkang = tamkangAuthStatus();
  assert.equal(tamkang.configured, false);
  assert.match(tamkang.message, /淡江 SSO 尚未完成設定/);
  await assert.rejects(() => tamkangStart(), /淡江 SSO 尚未完成設定/);
  await assert.rejects(() => Promise.resolve().then(() => googleStart()), /Google 登入尚未完成設定/);
  const session = await (await sessionRoute.GET(request("auth/session"))).json();
  assert.equal(session.user, null);
  assert.equal(session.providers.google, false);
  assert.equal(session.providers.tamkang.configured, false);
});

test("email register login session and workspace membership", async () => {
  const registered = await emailAuth.registerWithEmail({
    email: "owner@test.local",
    password: "test-password-12",
    name: "測試",
  });
  assert.equal(registered.signedIn, true);
  const cookie = registered.cookie!;
  const session = await (await sessionRoute.GET(request("auth/session", "GET", undefined, cookie))).json();
  assert.equal(session.user.email, "owner@test.local");
  assert.equal(session.membership, "owner");
  assert.equal(authenticate(request("workspace", "GET", undefined, cookie)), "workspace");
  assert.equal((await workspace.GET(request("workspace", "GET", undefined, cookie))).status, 200);
  assert.equal((await workspace.GET(request("workspace"))).status, 401);
  assert.equal((await healthRoute.GET(request("health"))).status, 200);
});

test("same email does not auto-merge Google identity", () => {
  const emailUser = identity.findIdentity("email", "owner@test.local");
  assert.ok(emailUser);
  const googleUser = identity.completeExternalLogin({
    provider: "google",
    subject: "google-sub-1",
    email: "owner@test.local",
    emailVerified: true,
    name: "Google 使用者",
    avatar: null,
  });
  assert.notEqual(googleUser.id, emailUser.userId);
  assert.throws(
    () =>
      identity.completeExternalLogin({
        provider: "google",
        subject: "google-sub-1",
        email: "owner@test.local",
        emailVerified: true,
        name: "Google 使用者",
        avatar: null,
        linkUserId: emailUser.userId,
      }),
    /自動合併|其他帳號/,
  );
});

test("email login rejects unknown passwords", () => {
  assert.throws(
    () => emailAuth.signInWithEmail("owner@test.local", "nope-password-12"),
    /電子信箱或密碼不正確/,
  );
  const ok = emailAuth.signInWithEmail("owner@test.local", "test-password-12");
  assert.match(ok.cookie, /hermes_session=/);
});

test("forged session cannot enter workspace", () => {
  assert.throws(
    () => authenticate(request("workspace", "GET", undefined, "hermes_session=" + "ab".repeat(32))),
    /登入已過期|請先登入/,
  );
});

test("explicit Google and Tamkang link stay on the signed-in user", () => {
  const emailUser = identity.findIdentity("email", "owner@test.local")!;
  const google = identity.completeExternalLogin({
    provider: "google",
    subject: "google-link-same-user",
    email: "google-link@test.local",
    emailVerified: true,
    name: "Google 連結",
    avatar: null,
    linkUserId: emailUser.userId,
  });
  assert.equal(google.id, emailUser.userId);
  const tamkang = identity.completeExternalLogin({
    provider: "tamkang",
    subject: "tku-link-same-user",
    email: "tku-link@test.local",
    emailVerified: true,
    name: "淡江連結",
    avatar: null,
    linkUserId: emailUser.userId,
  });
  assert.equal(tamkang.id, emailUser.userId);
  const shown = identity.publicUser(google).identities.map((item) => item.provider);
  assert.ok(shown.includes("email"));
  assert.ok(shown.includes("google"));
  assert.ok(shown.includes("tamkang"));
});

test("email can be linked to an existing Google user without auto-merge", async () => {
  const googleOnly = identity.completeExternalLogin({
    provider: "google",
    subject: "google-needs-email",
    email: "gonly@test.local",
    emailVerified: true,
    name: "G-only",
    avatar: null,
  });
  const linked = await emailAuth.linkEmailToUser(
    googleOnly.id,
    "gonly-login@test.local",
    "linked-password-12",
  );
  assert.equal(linked.linked, true);
  const signed = emailAuth.signInWithEmail(
    "gonly-login@test.local",
    "linked-password-12",
  );
  const session = await (
    await sessionRoute.GET(
      request("auth/session", "GET", undefined, signed.cookie.split(";")[0]),
    )
  ).json();
  assert.equal(session.user.id, googleOnly.id);
  assert.ok(
    session.user.identities.some((item: { provider: string }) => item.provider === "email"),
  );
  assert.throws(
    () =>
      identity.linkEmailIdentity(
        googleOnly.id,
        "owner@test.local",
        "another-password-12",
      ),
    /已連結電子信箱/,
  );
  const otherGoogle = identity.completeExternalLogin({
    provider: "google",
    subject: "google-merge-blocked",
    email: "blocked@test.local",
    emailVerified: true,
    name: "Blocked",
    avatar: null,
  });
  assert.throws(
    () =>
      identity.linkEmailIdentity(
        otherGoogle.id,
        "owner@test.local",
        "another-password-12",
      ),
    /自動合併/,
  );
});

test("email link requires a session", async () => {
  const response = await emailRoute.POST(
    request("auth/email", "POST", {
      action: "link",
      email: "need-session@test.local",
      password: "test-password-12",
    }),
  );
  assert.equal(response.status, 401);
});

test("email API register is origin-bound", async () => {
  const response = await emailRoute.POST(
    new Request("http://localhost:3310/api/auth/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify({
        action: "register",
        email: "x@test.local",
        password: "test-password-12",
        name: "X",
      }),
    }),
  );
  assert.equal(response.status, 403);
});

test("logout clears the session cookie", async () => {
  const logout = await import("../app/api/auth/logout/route");
  const signed = emailAuth.signInWithEmail("owner@test.local", "test-password-12");
  const cookie = signed.cookie.split(";")[0];
  const response = await logout.POST(
    request("auth/logout", "POST", {}, cookie),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/);
  assert.throws(
    () => authenticate(request("workspace", "GET", undefined, cookie)),
    /登入已過期|請先登入/,
  );
});

test("password reset tokens are single-use", () => {
  const userId = identity.findIdentity("email", "owner@test.local")!.userId;
  const token = identity.putAuthToken({
    type: "reset",
    userId,
    ttlMs: 30 * 60_000,
  });
  assert.equal(identity.consumeAuthToken("reset", token), userId);
  assert.throws(
    () => identity.consumeAuthToken("reset", token),
    /連結無效或已過期/,
  );
  identity.setPassword(userId, "new-password-12");
  emailAuth.signInWithEmail("owner@test.local", "new-password-12");
});

test("member without workspace membership is forbidden", () => {
  const outsider = identity.completeExternalLogin({
    provider: "google",
    subject: "google-no-membership",
    email: "outsider@test.local",
    emailVerified: false,
    name: "Outsider",
    avatar: null,
  });
  const token = identity.issueSession(outsider.id);
  assert.throws(
    () =>
      authenticate(
        request(
          "workspace",
          "GET",
          undefined,
          identity.sessionCookie(token).split(";")[0],
        ),
      ),
    /還沒有工作區權限/,
  );
});
