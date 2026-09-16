import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-invites-"));
process.env.CONSOLE_ORIGIN = "https://console.example";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_ADMIN_EMAILS = "admin@example.test";
process.env.CONSOLE_EMAIL_FROM = "console@example.test";
process.env.RESEND_API_KEY = randomBytes(30).toString("hex");

const auth = await import("../app/api/auth/route");
const { list } = await import("../lib/server/store");

const req = (method = "GET", body?: unknown, cookie = "") =>
  new Request("https://console.example/api/auth", {
    method,
    headers: {
      Origin: "https://console.example",
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("magic link is email auth; invitation APIs stay dormant behind a session", async () => {
  const original = globalThis.fetch;
  const emails: Array<{ to: string[]; text: string }> = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    emails.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "fixture-email-" + emails.length });
  };
  try {
    assert.equal((await auth.GET(req())).status, 401);
    assert.equal(
      (
        await auth.POST(
          new Request("https://console.example/api/auth", {
            method: "POST",
            headers: {
              Origin: "https://attacker.example",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              action: "request_link",
              email: "admin@example.test",
            }),
          }),
        )
      ).status,
      403,
    );
    const unknown = await auth.POST(
      req("POST", { action: "request_link", email: "stranger@example.test" }),
    );
    assert.equal(unknown.status, 202);
    assert.equal(emails.length, 0);

    const registered = await auth.POST(
      req("POST", {
        action: "register",
        email: "owner@example.test",
        password: "Test-Password-14",
        name: "擁有者",
      }),
    );
    assert.equal(registered.status, 201);
    const ownerCookie = registered.headers.get("set-cookie")!.split(";")[0];
    await auth.DELETE(req("DELETE", {}, ownerCookie));

    const invited = await auth.POST(
      req("POST", { action: "request_link", email: "owner@example.test" }),
    );
    assert.equal(invited.status, 202);
    assert.equal(emails.length, 1);
    const token = emails[0].text.match(/#login=([a-f0-9]{64})/)![1];
    assert.ok(!JSON.stringify(list("auth_token", "identity")).includes(token));
    const login = await auth.POST(req("POST", { action: "redeem", token }));
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(login.headers.get("set-cookie")!, /Secure/);
    assert.equal((await auth.POST(req("POST", { action: "redeem", token }))).status, 401);
    assert.equal((await auth.GET(req("GET", undefined, cookie))).status, 200);
    await auth.DELETE(req("DELETE", undefined, cookie));
    assert.equal((await auth.GET(req("GET", undefined, cookie))).status, 401);
    assert.ok(
      !JSON.stringify(list("user", "identity")).includes(process.env.RESEND_API_KEY!),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("unset CONSOLE_ADMIN_EMAILS bootstraps the owner as administrator", async () => {
  const previous = process.env.CONSOLE_ADMIN_EMAILS;
  process.env.CONSOLE_ADMIN_EMAILS = "";
  try {
    const { members } = await import("../lib/server/invitations");
    assert.ok(
      members().some(
        (m) =>
          m.email === "aa0968111723@gmail.com" &&
          m.role === "admin" &&
          m.active &&
          m.bootstrap,
      ),
    );
  } finally {
    process.env.CONSOLE_ADMIN_EMAILS = previous;
  }
});
