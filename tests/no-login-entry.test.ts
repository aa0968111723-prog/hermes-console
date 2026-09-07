import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-nologin-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3212";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
delete process.env.CONSOLE_ADMIN_EMAILS;
delete process.env.RESEND_API_KEY;
delete process.env.CONSOLE_EMAIL_FROM;

const security = await import("../lib/server/security");
const workspace = await import("../app/api/workspace/route");
const tasks = await import("../app/api/tasks/route");
const health = await import("../app/api/health/route");
const runtime = await import("../app/api/runtime/route");
const conversations = await import("../app/api/conversations/route");
const confirm = await import("../app/api/confirm/route");

function request(
  path: string,
  method = "GET",
  body?: unknown,
  origin = process.env.CONSOLE_ORIGIN,
) {
  return new Request("http://localhost:3212/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("no-login entry contracts", async (t) => {
  await t.test("root page does not import InvitationGate", async () => {
    const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
    assert.ok(!page.includes("InvitationGate"));
    assert.ok(page.includes("HermesConsole"));
  });

  await t.test("FEATURE_AUDIT matches no-login workspace and stub research", async () => {
    const audit = await readFile(
      new URL("../docs/FEATURE_AUDIT_EDU.md", import.meta.url),
      "utf8",
    );
    assert.match(audit, /免登入/);
    assert.match(audit, /InvitationGate/);
    assert.match(audit, /researchBundle/);
    assert.match(audit, /executed: false/);
    assert.match(audit, /API only/);
    assert.doesNotMatch(audit, /正式必填/);
    assert.doesNotMatch(audit, /公開部署沒有閘道會 fail closed/);
    assert.doesNotMatch(audit, /GET 回 `no-login`/);
  });

  await t.test("authenticate is no-login single workspace", () => {
    assert.equal(
      security.authenticate(new Request("http://localhost:3212/api/workspace")),
      "workspace",
    );
    assert.equal(
      security.authenticate(
        new Request("http://localhost:3212/api/workspace", {
          headers: { Cookie: "hermes_invite_session=not-a-session" },
        }),
      ),
      "workspace",
    );
  });

  await t.test("workspace, health and tasks GET do not require a member session", async () => {
    assert.equal((await workspace.GET(request("workspace"))).status, 200);
    assert.equal((await health.GET(request("health"))).status, 200);
    assert.equal((await tasks.GET(request("tasks"))).status, 200);
    const runtimeResponse = await runtime.GET(request("runtime"));
    assert.notEqual(runtimeResponse.status, 401);
    assert.ok(runtimeResponse.status === 200 || runtimeResponse.status >= 500);
  });

  await t.test("mutations still check Origin", async () => {
    assert.equal(
      (
        await workspace.POST(
          request("workspace", "POST", { name: "blocked" }, "https://attacker.example"),
        )
      ).status,
      403,
    );
    assert.equal(
      (await workspace.POST(request("workspace", "POST", { name: "ok" }))).status,
      201,
    );
  });

  await t.test("loopback development can mutate without CONSOLE_ORIGIN", () => {
    const previous = process.env.CONSOLE_ORIGIN;
    delete process.env.CONSOLE_ORIGIN;
    try {
      assert.equal(
        security.authenticate(
          new Request("http://127.0.0.1:3000/api/workspace", {
            method: "POST",
            headers: { Origin: "http://127.0.0.1:3000" },
          }),
          true,
        ),
        "workspace",
      );
      assert.throws(
        () =>
          security.authenticate(
            new Request("https://public.example/api/workspace", {
              method: "POST",
              headers: { Origin: "https://public.example" },
            }),
            true,
          ),
        /尚未設定 CONSOLE_ORIGIN/,
      );
    } finally {
      process.env.CONSOLE_ORIGIN = previous;
    }
  });

  await t.test("rate limit remains active", () => {
    security.limited("nologin-rate", 2, 60_000);
    security.limited("nologin-rate", 2, 60_000);
    assert.throws(() => security.limited("nologin-rate", 2, 60_000), /限制/);
  });

  await t.test("confirmation tokens remain active", async () => {
    const minted = await confirm.POST(
      request("confirm", "POST", {
        action: "destructive",
        target: "workspace",
        payload: { id: "nologin" },
      }),
    );
    assert.equal(minted.status, 200);
    const token = (await minted.json()).token;
    assert.equal(
      (
        await confirm.POST(
          request("confirm", "POST", {
            action: "destructive",
            target: "workspace",
            payload: { id: "nologin" },
            token: "a".repeat(64),
            consume: true,
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await confirm.POST(
          request("confirm", "POST", {
            action: "destructive",
            target: "workspace",
            payload: { id: "nologin" },
            token,
            consume: true,
          }),
        )
      ).status,
      200,
    );
    const created = await conversations.POST(
      request("conversations", "POST", { title: "免登入對話" }),
    );
    assert.equal(created.status, 201);
  });
});
