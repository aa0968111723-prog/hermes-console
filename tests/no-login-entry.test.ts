import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSession } from "./session-fixture";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-auth-entry-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3212";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
delete process.env.CONSOLE_ADMIN_EMAILS;
delete process.env.RESEND_API_KEY;
delete process.env.CONSOLE_EMAIL_FROM;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.TAMKANG_SSO_ISSUER;
delete process.env.TAMKANG_SSO_CLIENT_ID;
delete process.env.CONSOLE_TEST_SESSION;

const security = await import("../lib/server/security");
const workspace = await import("../app/api/workspace/route");
const tasks = await import("../app/api/tasks/route");
const health = await import("../app/api/health/route");
const ready = await import("../app/api/ready/route");
const runtime = await import("../app/api/runtime/route");
const conversations = await import("../app/api/conversations/route");
const confirm = await import("../app/api/confirm/route");
const credentials = await import("../app/api/settings/credentials/route");
const memory = await import("../app/api/memory/route");
const auth = await import("../app/api/auth/route");
const google = await import("../app/api/auth/google/route");
const tamkang = await import("../app/api/auth/tamkang/route");
const { providerStatus, registerEmail, loginEmail } = await import(
  "../lib/server/identity"
);

function request(
  path: string,
  method = "GET",
  body?: unknown,
  origin = process.env.CONSOLE_ORIGIN,
  cookie = "",
) {
  return new Request("http://localhost:3212/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("authentication entry contracts", async (t) => {
  await t.test("homepage uses AuthGate, not InvitationGate", async () => {
    const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
    assert.ok(page.includes("AuthGate"));
    assert.ok(page.includes("HermesConsole"));
    assert.ok(!page.includes("InvitationGate"));
  });

  await t.test("Google and Tamkang stay unconfigured without secrets", async () => {
    const providers = providerStatus();
    assert.equal(providers.google.configured, false);
    assert.equal(providers.tamkang.configured, false);
    assert.match(providers.tamkang.label, /尚未完成設定/);
    assert.equal((await google.GET(request("auth/google"))).status, 503);
    assert.equal((await tamkang.GET(request("auth/tamkang"))).status, 503);
  });

  await t.test("health and ready stay public and secret-free", async () => {
    const healthRes = await health.GET(request("health"));
    const readyRes = await ready.GET(request("ready"));
    assert.equal(healthRes.status, 200);
    assert.equal(readyRes.status, 200);
    const body = JSON.stringify(await healthRes.json()) + JSON.stringify(await readyRes.json());
    assert.doesNotMatch(body, /Bearer |sk-|postgres(?:ql)?:\/\//i);
  });

  await t.test("workspace APIs reject anonymous callers", async () => {
    assert.equal((await workspace.GET(request("workspace"))).status, 401);
    assert.equal((await tasks.GET(request("tasks"))).status, 401);
    assert.equal((await credentials.GET(request("settings/credentials"))).status, 401);
    assert.equal((await memory.GET(request("memory"))).status, 401);
    assert.equal((await runtime.GET(request("runtime"))).status, 401);
    assert.throws(
      () => security.authenticate(new Request("http://localhost:3212/api/workspace")),
      /請先登入/,
    );
  });

  await t.test("first email account becomes owner and can use the workspace", async () => {
    const registered = await auth.POST(
      request("auth", "POST", {
        action: "register",
        email: "owner@example.test",
        password: "Test-Password-14",
        name: "擁有者",
      }),
    );
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get("set-cookie") || "";
    assert.match(cookie, /hermes_session=[a-f0-9]{64}/);
    const token = /hermes_session=([a-f0-9]{64})/.exec(cookie)![1];
    assert.equal(
      (await workspace.GET(request("workspace", "GET", undefined, process.env.CONSOLE_ORIGIN, "hermes_session=" + token))).status,
      200,
    );
    const created = await conversations.POST(
      request(
        "conversations",
        "POST",
        { title: "登入後對話" },
        process.env.CONSOLE_ORIGIN,
        "hermes_session=" + token,
      ),
    );
    assert.equal(created.status, 201);
  });

  await t.test("password login rejects wrong password and does not merge identities by email", async () => {
    assert.throws(
      () => loginEmail({ email: "owner@example.test", password: "wrong-password-999" }),
      /帳號或密碼不正確/,
    );
    await assert.rejects(
      () =>
        registerEmail({
          email: "owner@example.test",
          password: "Another-Password-14",
          name: "其他人",
        }),
      /已有帳號/,
    );
  });

  await t.test("mutations still check Origin", async () => {
    const { cookie } = seedSession();
    assert.equal(
      (
        await workspace.POST(
          request("workspace", "POST", { name: "blocked" }, "https://attacker.example", cookie),
        )
      ).status,
      403,
    );
    assert.equal(
      (await workspace.POST(request("workspace", "POST", { name: "ok" }, process.env.CONSOLE_ORIGIN, cookie))).status,
      201,
    );
  });

  await t.test("rate limit and confirmation remain active", async () => {
    const { cookie } = seedSession();
    security.limited("auth-rate", 2, 60_000);
    security.limited("auth-rate", 2, 60_000);
    assert.throws(() => security.limited("auth-rate", 2, 60_000), /限制/);
    const minted = await confirm.POST(
      request(
        "confirm",
        "POST",
        { action: "destructive", target: "workspace", payload: { id: "auth" } },
        process.env.CONSOLE_ORIGIN,
        cookie,
      ),
    );
    assert.equal(minted.status, 200);
  });
});
