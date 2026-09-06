import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-invites-"));
process.env.CONSOLE_ORIGIN = "https://console.example";
process.env.CONSOLE_ADMIN_EMAILS = "admin@example.test";
process.env.CONSOLE_EMAIL_FROM = "console@example.test";
process.env.RESEND_API_KEY = randomBytes(30).toString("hex");
const auth = await import("../app/api/auth/route");
const access = await import("../app/api/invitations/route");
const { get, put, list } = await import("../lib/server/store");
const { hash } = await import("../lib/server/security");
const req = (method = "GET", body?: unknown, cookie = "") => new Request("https://console.example/api/auth", {
  method, headers: { Origin: "https://console.example", "Content-Type": "application/json", Cookie: cookie },
  body: body === undefined ? undefined : JSON.stringify(body),
});
test("invitation lifecycle uses real handlers; mail provider is an explicit fixture", async () => {
  const original = globalThis.fetch;
  const emails: Array<{to: string[]; text: string}> = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    assert.equal(init?.redirect, "error");
    emails.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "fixture-email-" + emails.length });
  };
  try {
    assert.equal((await auth.GET(req())).status, 401);
    assert.equal((await auth.POST(new Request("https://console.example/api/auth", {
      method: "POST", headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "request_link", email: "admin@example.test" }),
    }))).status, 403);
    const unknown = await auth.POST(req("POST", { action: "request_link", email: "stranger@example.test" }));
    assert.equal(unknown.status, 202);
    assert.equal(emails.length, 0);
    const invited = await auth.POST(req("POST", { action: "request_link", email: "admin@example.test" }));
    assert.deepEqual(await unknown.json(), await invited.json(), "do not enumerate members in public response");
    const token = emails[0].text.match(/#login=([a-f0-9]{64})/)![1];
    assert.ok(!JSON.stringify(list("login_link", "access")).includes(token), "only token hashes persisted");
    const login = await auth.POST(req("POST", { action: "redeem", token }));
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(login.headers.get("set-cookie")!, /Secure/);
    assert.equal((await auth.POST(req("POST", { action: "redeem", token }))).status, 401);
    assert.equal((await auth.GET(req("GET", undefined, cookie))).status, 200);
    assert.equal((await access.POST(req("POST", { email: "member@example.test" }, cookie))).status, 201);
    const memberToken = emails[1].text.match(/#login=([a-f0-9]{64})/)![1];
    const memberLogin = await auth.POST(req("POST", { action: "redeem", token: memberToken }));
    const memberCookie = memberLogin.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await access.GET(req("GET", undefined, memberCookie))).status, 403);
    assert.equal((await access.POST(req("POST", { email: "attacker@example.test" }, memberCookie))).status, 403);
    await auth.POST(req("POST", { action: "request_link", email: "member@example.test" }));
    const outstanding = emails[2].text.match(/#login=([a-f0-9]{64})/)![1];
    assert.equal((await access.DELETE(req("DELETE", { id: hash("member@example.test") }, cookie))).status, 200);
    assert.equal((await auth.GET(req("GET", undefined, memberCookie))).status, 401);
    assert.equal((await auth.POST(req("POST", { action: "redeem", token: outstanding }))).status, 401);
    assert.equal((await access.DELETE(req("DELETE", { id: hash("admin@example.test") }, cookie))).status, 409);
    await auth.DELETE(req("DELETE", undefined, cookie));
    assert.equal((await auth.GET(req("GET", undefined, cookie))).status, 401);
    globalThis.fetch = async () => new Response("provider secret error", { status: 429 });
    await auth.POST(req("POST", { action: "request_link", email: "admin@example.test" }));
    assert.equal(get<{delivery: string}>("member", "access", hash("admin@example.test"))?.delivery, "failed");
    const active = list<{id: string; used: boolean}>("login_link", "access").find(l => !l.used);
    assert.equal(active, undefined);
    assert.ok(!JSON.stringify(list("member", "access")).includes(process.env.RESEND_API_KEY!));
    put("login_link", "access", { id: hash("e".repeat(64)), memberId: hash("admin@example.test"), used: false, expires: Date.now() - 1 });
    assert.equal((await auth.POST(req("POST", { action: "redeem", token: "e".repeat(64) }))).status, 401);
    const oldSession = randomBytes(32).toString("hex"), oldLink = randomBytes(32).toString("hex");
    put("invite_session", "access", { id: hash(oldSession), memberId: hash("admin@example.test"), expires: Date.now() + 60000 });
    put("login_link", "access", { id: hash(oldLink), memberId: hash("admin@example.test"), expires: Date.now() + 60000, used: false });
    process.env.CONSOLE_ADMIN_EMAILS = "replacement@example.test";
    assert.equal((await auth.POST(req("POST", { action: "redeem", token: oldLink }))).status, 401);
    process.env.CONSOLE_ADMIN_EMAILS = "admin@example.test";
    assert.equal((await auth.GET(req("GET", undefined, "hermes_invite_session=" + oldSession))).status, 401,
      "re-adding an administrator cannot resurrect revoked sessions");
  } finally { globalThis.fetch = original; }
});
