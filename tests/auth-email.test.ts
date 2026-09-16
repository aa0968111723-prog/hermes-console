import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-auth-email-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3310";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_AUTH_MODE = "required";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
delete process.env.RESEND_API_KEY;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

const { registerEmail, loginEmail } = await import(
  "../lib/server/auth/providers/email"
);
const { hashPassword, verifySecret } = await import(
  "../lib/server/auth/password"
);
const { getMembership, identitiesFor } = await import(
  "../lib/server/auth/identity"
);
const emailRoute = await import("../app/api/auth/email/route");
const workspace = await import("../app/api/workspace/route");
const session = await import("../app/api/auth/session/route");
const { authenticate } = await import("../lib/server/security");

function request(path: string, method = "GET", body?: unknown, cookie?: string) {
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

test("email argon2id register/login and workspace membership", async () => {
  const encoded = await hashPassword("correct-horse-battery");
  assert.match(encoded, /^\$argon2id\$/);
  assert.equal(await verifySecret("correct-horse-battery", encoded), true);
  assert.equal(await verifySecret("wrong-password-battery", encoded), false);

  const created = await registerEmail("owner@example.test", "correct-horse-battery");
  assert.equal(created.mail, "unconfigured");
  const membership = getMembership(
    (await import("../lib/server/auth/identity")).listUsers()[0].id,
  );
  assert.equal(membership?.role, "owner");
  const ident = identitiesFor(membership!.userId);
  assert.equal(ident.some((item) => item.provider === "email"), true);

  await assert.rejects(
    () => registerEmail("owner@example.test", "correct-horse-battery"),
    /已註冊/,
  );

  const logged = await loginEmail("owner@example.test", "correct-horse-battery");
  assert.match(logged.header, /hermes_session=/);

  const unauth = await workspace.GET(request("workspace"));
  assert.equal(unauth.status, 401);
  assert.equal((await unauth.json()).error.category, "AUTH_ERROR");

  const cookie = logged.header.split(";")[0];
  assert.equal((await workspace.GET(request("workspace", "GET", undefined, cookie))).status, 200);

  const snap = await session.GET(request("auth/session", "GET", undefined, cookie));
  assert.equal(snap.status, 200);
  const body = await snap.json();
  assert.equal(body.required, true);
  assert.equal(body.google, "unconfigured");
  assert.equal(body.tamkang, "unconfigured");
  assert.equal(body.user.email, "owner@example.test");

  const api = await emailRoute.POST(
    request("auth/email", "POST", {
      action: "login",
      email: "owner@example.test",
      password: "wrong-password-battery",
    }),
  );
  assert.equal(api.status, 401);

  assert.throws(
    () => authenticate(request("workspace")),
    /請先登入/,
  );
});

test("magic link and password reset are single-use and do not enumerate mail", async () => {
  const { hash } = await import("../lib/server/security");
  const { putAuthToken, listUsers } = await import("../lib/server/auth/identity");
  const {
    redeemMagicLink,
    resetPassword,
  } = await import("../lib/server/auth/providers/email");

  await registerEmail("token@example.test", "correct-horse-battery");
  const userId = listUsers().find((user) => user.email === "token@example.test")!.id;
  const magic = "ab".repeat(32);
  putAuthToken(hash(magic), {
    userId,
    purpose: "magic_link",
    expiresAt: Date.now() + 60_000,
    used: false,
  });
  assert.match(redeemMagicLink(magic).header, /hermes_session=/);
  assert.throws(() => redeemMagicLink(magic), /已使用|過期|不存在/);

  const reset = "cd".repeat(32);
  putAuthToken(hash(reset), {
    userId,
    purpose: "reset_password",
    expiresAt: Date.now() + 60_000,
    used: false,
  });
  assert.match(
    (await resetPassword(reset, "new-horse-battery")).header,
    /hermes_session=/,
  );
  assert.match(
    (await loginEmail("token@example.test", "new-horse-battery")).header,
    /hermes_session=/,
  );

  const unknown = await emailRoute.POST(
    request("auth/email", "POST", {
      action: "magic_link",
      email: "nobody@example.test",
    }),
  );
  const known = await emailRoute.POST(
    request("auth/email", "POST", {
      action: "magic_link",
      email: "token@example.test",
    }),
  );
  assert.equal(unknown.status, 202);
  assert.equal(known.status, 202);
  assert.equal((await unknown.json()).message, (await known.json()).message);
});
