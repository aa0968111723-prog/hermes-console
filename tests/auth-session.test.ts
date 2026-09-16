import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-auth-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3240";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_AUTH_REQUIRED = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.TAMKANG_SSO_ISSUER;
delete process.env.TAMKANG_SSO_CLIENT_ID;
delete process.env.TAMKANG_SSO_CLIENT_SECRET;
delete process.env.TAMKANG_SSO_PROTOCOL;
delete process.env.RESEND_API_KEY;
delete process.env.CONSOLE_EMAIL_FROM;

const sessionRoute = await import("../app/api/auth/session/route");
const sessionsRoute = await import("../app/api/auth/sessions/route");
const emailRoute = await import("../app/api/auth/email/route");
const googleRoute = await import("../app/api/auth/google/route");
const tamkangRoute = await import("../app/api/auth/tamkang/route");
const logoutRoute = await import("../app/api/auth/logout/route");
const workspace = await import("../app/api/workspace/route");
const security = await import("../lib/server/security");
const identity = await import("../lib/server/auth/identity");
const { hashPassword, verifyPassword } = await import("../lib/server/auth/passwords");

function request(path: string, method = "GET", body?: unknown, cookie = "", ua = "") {
  return new Request("http://localhost:3240/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3240",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(ua ? { "User-Agent": ua } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("unified authentication is honest and session-backed", async (t) => {
  await t.test("Google and Tamkang stay unconfigured without secrets", async () => {
    const snapshot = await (await sessionRoute.GET(request("auth/session"))).json();
    assert.equal(snapshot.user, null);
    const google = snapshot.providers.find((item: { id: string }) => item.id === "google");
    const tamkang = snapshot.providers.find((item: { id: string }) => item.id === "tamkang");
    assert.equal(google.configured, false);
    assert.match(google.message, /尚未完成設定/);
    assert.equal(tamkang.configured, false);
    assert.equal(tamkang.message, "淡江 SSO 尚未完成設定");
    assert.equal((await googleRoute.GET(request("auth/google"))).status, 503);
    assert.equal((await tamkangRoute.GET(request("auth/tamkang"))).status, 503);
  });

  await t.test("email register/login/logout on loopback", async () => {
    const created = await emailRoute.POST(
      request("auth/email", "POST", {
        action: "register",
        email: "owner@example.test",
        password: "correct-horse",
        name: "Owner",
      }),
    );
    assert.equal(created.status, 201);
    const cookie = created.headers.get("set-cookie") || "";
    assert.match(cookie, /hermes_auth=/);
    assert.ok(!cookie.toLowerCase().includes("correct-horse"));
    const signedIn = await (await sessionRoute.GET(request("auth/session", "GET", undefined, cookie))).json();
    assert.equal(signedIn.user.email, "owner@example.test");
    assert.equal(signedIn.membership.role, "owner");
    const loggedIn = await emailRoute.POST(
      request("auth/email", "POST", {
        action: "login",
        email: "owner@example.test",
        password: "correct-horse",
      }),
    );
    assert.equal(loggedIn.status, 200);
    const wrong = await emailRoute.POST(
      request("auth/email", "POST", {
        action: "login",
        email: "owner@example.test",
        password: "wrong-password",
      }),
    );
    assert.equal(wrong.status, 401);
    const body = await wrong.json();
    assert.equal(body.error.category, "AUTH_ERROR");
    const out = await logoutRoute.POST(request("auth/logout", "POST", {}, cookie));
    assert.equal(out.status, 200);
  });

  await t.test("second user is not auto-merged and needs membership", async () => {
    const second = await emailRoute.POST(
      request("auth/email", "POST", {
        action: "register",
        email: "member@example.test",
        password: "correct-horse",
      }),
    );
    assert.equal(second.status, 201);
    const cookie = second.headers.get("set-cookie") || "";
    const snapshot = await (await sessionRoute.GET(request("auth/session", "GET", undefined, cookie))).json();
    assert.equal(snapshot.membership, null);
    process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "false";
    assert.throws(
      () => security.authenticate(request("workspace", "GET", undefined, cookie)),
      /尚未加入/,
    );
    const owner = identity.findUserByEmail("owner@example.test");
    identity.grantMembership(snapshot.user.id, "member");
    assert.equal(
      security.authenticate(request("workspace", "GET", undefined, cookie)),
      "workspace",
    );
    assert.equal(owner && identity.membershipOf(owner.id)?.role, "owner");
    process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
  });

  await t.test("members cannot change connection secrets", async () => {
    const loggedIn = await emailRoute.POST(
      request("auth/email", "POST", {
        action: "login",
        email: "member@example.test",
        password: "correct-horse",
      }),
    );
    const cookie = loggedIn.headers.get("set-cookie") || "";
    process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "false";
    assert.throws(
      () =>
        security.authenticate(
          request("settings/credentials", "POST", {}, cookie),
          true,
          true,
        ),
      /擁有者或管理員/,
    );
    const member = identity.findUserByEmail("member@example.test");
    identity.grantMembership(member!.id, "admin");
    assert.equal(
      security.authenticate(
        request("settings/credentials", "POST", {}, cookie),
        true,
        true,
      ),
      "workspace",
    );
    identity.grantMembership(member!.id, "member");
    process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
  });

  await t.test("same email does not auto-merge identities", () => {
    const googleUser = identity.resolveLoginIdentity({
      provider: "google",
      providerSubject: "google-sub-1",
      email: "shared@example.test",
      emailVerified: true,
      name: "Google User",
      avatarUrl: null,
    });
    const other = identity.resolveLoginIdentity({
      provider: "tamkang",
      providerSubject: "tku-sub-9",
      email: "shared@example.test",
      emailVerified: true,
      name: "Tamkang User",
      avatarUrl: null,
    });
    assert.notEqual(googleUser.id, other.id);
    assert.throws(
      () =>
        identity.attachIdentity({
          userId: other.id,
          provider: "google",
          providerSubject: "google-sub-1",
          email: "shared@example.test",
          emailVerified: true,
          name: "x",
          avatarUrl: null,
        }),
      /未自動合併/,
    );
  });

  await t.test("enforced auth rejects anonymous workspace reads", () => {
    process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "false";
    process.env.CONSOLE_AUTH_REQUIRED = "true";
    assert.throws(
      () => security.authenticate(request("workspace")),
      /請先登入/,
    );
    process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
  });

  await t.test("magic link is single-use", async () => {
    process.env.RESEND_API_KEY = randomBytes(24).toString("hex");
    process.env.CONSOLE_EMAIL_FROM = "hermes@example.test";
    const emails: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      emails.push(String(init?.body));
      return Response.json({ id: "mail-1" });
    };
    try {
      const sent = await emailRoute.POST(
        request("auth/email", "POST", {
          action: "magic_link",
          email: "owner@example.test",
        }),
      );
      assert.equal(sent.status, 202);
      const token = emails[0].match(/#login=([a-f0-9]{64})/)![1];
      const first = await emailRoute.POST(
        request("auth/email", "POST", { action: "redeem", token }),
      );
      assert.equal(first.status, 200);
      const second = await emailRoute.POST(
        request("auth/email", "POST", { action: "redeem", token }),
      );
      assert.equal(second.status, 401);
    } finally {
      globalThis.fetch = original;
    }
  });

  await t.test("password reset expires after use", async () => {
    const emails: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      emails.push(String(init?.body));
      return Response.json({ id: "mail-2" });
    };
    try {
      await emailRoute.POST(
        request("auth/email", "POST", {
          action: "forgot",
          email: "owner@example.test",
        }),
      );
      const token = emails[0].match(/#reset=([a-f0-9]{64})/)![1];
      const reset = await emailRoute.POST(
        request("auth/email", "POST", {
          action: "reset",
          token,
          password: "new-password-1",
        }),
      );
      assert.equal(reset.status, 200);
      assert.equal(
        (
          await emailRoute.POST(
            request("auth/email", "POST", {
              action: "reset",
              token,
              password: "new-password-2",
            }),
          )
        ).status,
        401,
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  await t.test("argon2id hashes verify and never store plaintext", () => {
    const encoded = hashPassword("correct-horse");
    assert.match(encoded, /^argon2id:/);
    assert.equal(verifyPassword("correct-horse", encoded), true);
    assert.equal(verifyPassword("wrong", encoded), false);
  });

  await t.test("account sessions can be listed and revoked except the current one", async () => {
    const created = await emailRoute.POST(
      request(
        "auth/email",
        "POST",
        {
          action: "register",
          email: "sessions@example.test",
          password: "correct-horse",
          name: "Sessions",
        },
        "",
        "Mozilla/5.0 Safari/17",
      ),
    );
    assert.equal(created.status, 201);
    const firstCookie = created.headers.get("set-cookie") || "";
    const second = await emailRoute.POST(
      request(
        "auth/email",
        "POST",
        {
          action: "login",
          email: "sessions@example.test",
          password: "correct-horse",
        },
        "",
        "Mozilla/5.0 Chrome/120.0.0.0",
      ),
    );
    assert.equal(second.status, 200);
    const secondCookie = second.headers.get("set-cookie") || "";
    assert.equal(
      (await sessionsRoute.GET(request("auth/sessions"))).status,
      401,
    );
    const listed = await (
      await sessionsRoute.GET(
        request("auth/sessions", "GET", undefined, secondCookie),
      )
    ).json();
    assert.equal(listed.sessions.length, 2);
    const current = listed.sessions.find(
      (item: { current: boolean }) => item.current,
    );
    const other = listed.sessions.find(
      (item: { current: boolean }) => !item.current,
    );
    assert.equal(current.device, "Chrome");
    assert.equal(other.device, "Safari");
    assert.equal(
      (
        await sessionsRoute.DELETE(
          request("auth/sessions", "DELETE", { id: current.id }, secondCookie),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await sessionsRoute.DELETE(
          new Request("http://localhost:3240/api/auth/sessions", {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://attacker.example",
              Cookie: secondCookie,
            },
            body: JSON.stringify({ id: other.id }),
          }),
        )
      ).status,
      403,
    );
    const revoked = await sessionsRoute.DELETE(
      request("auth/sessions", "DELETE", { id: other.id }, secondCookie),
    );
    assert.equal(revoked.status, 200);
    const after = await (
      await sessionsRoute.GET(
        request("auth/sessions", "GET", undefined, secondCookie),
      )
    ).json();
    assert.equal(after.sessions.length, 1);
    assert.equal(after.sessions[0].current, true);
    const stale = await (
      await sessionRoute.GET(
        request("auth/session", "GET", undefined, firstCookie),
      )
    ).json();
    assert.equal(stale.user, null);
  });

  await t.test("workspace mutations still check origin", async () => {
    assert.equal(
      (
        await workspace.POST(
          new Request("http://localhost:3240/api/workspace", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://attacker.example",
            },
            body: JSON.stringify({ name: "nope" }),
          }),
        )
      ).status,
      403,
    );
  });
});
