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
const ready = await import("../app/api/ready/route");
const runtime = await import("../app/api/runtime/route");
const conversations = await import("../app/api/conversations/route");
const confirm = await import("../app/api/confirm/route");
const credentials = await import("../app/api/settings/credentials/route");
const memory = await import("../app/api/memory/route");
const artifacts = await import("../app/api/artifacts/route");

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
  await t.test("root page uses AuthGate and does not import InvitationGate", async () => {
    const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
    const agents = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
    assert.ok(!page.includes("InvitationGate"));
    assert.ok(page.includes("AuthGate"));
    assert.match(agents, /No-Login Single Workspace/);
  });

  await t.test("FEATURE_AUDIT matches no-login workspace and stub research", async () => {
    const audit = await readFile(
      new URL("../docs/FEATURE_AUDIT_EDU.md", import.meta.url),
      "utf8",
    );
    assert.match(audit, /免登入/);
    assert.match(audit, /InvitationGate/);
    assert.match(audit, /AuthGate/);
    assert.match(audit, /researchBundle/);
    assert.match(audit, /executed: false/);
    assert.match(audit, /API only/);
    assert.match(audit, /dormant/);
    assert.match(audit, /可選/);
    assert.match(audit, /No-Login|免登入/);
    assert.doesNotMatch(audit, /正式必填/);
    assert.doesNotMatch(audit, /公開部署沒有閘道會 fail closed/);
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

  await t.test("login gate is opt-in", async () => {
    const { isAuthEnforced } = await import("../lib/server/auth/session");
    const allow = process.env.CONSOLE_ALLOW_LOCAL_ACCESS;
    const required = process.env.CONSOLE_AUTH_REQUIRED;
    try {
      delete process.env.CONSOLE_ALLOW_LOCAL_ACCESS;
      delete process.env.CONSOLE_AUTH_REQUIRED;
      assert.equal(isAuthEnforced(), false);
      assert.equal(security.canInspectRuntime(request("runtime")), true);
      process.env.CONSOLE_AUTH_REQUIRED = "true";
      assert.equal(isAuthEnforced(), true);
      assert.equal(security.canInspectRuntime(request("runtime")), false);
      process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
      assert.equal(isAuthEnforced(), false);
      assert.equal(security.canInspectRuntime(request("runtime")), true);
    } finally {
      process.env.CONSOLE_ALLOW_LOCAL_ACCESS = allow;
      if (required === undefined) delete process.env.CONSOLE_AUTH_REQUIRED;
      else process.env.CONSOLE_AUTH_REQUIRED = required;
    }
  });

  await t.test("AuthGate fails open into the workspace", async () => {
    const gate = await readFile(
      new URL("../components/auth/AuthGate.tsx", import.meta.url),
      "utf8",
    );
    assert.match(gate, /OPEN_SESSION/);
    assert.match(gate, /required: false/);
    assert.doesNotMatch(gate, /無法確認登入狀態/);
    assert.doesNotMatch(gate, /正在確認身分/);
    const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
    assert.match(page, /AuthGate/);
    assert.doesNotMatch(page, /InvitationGate/);
  });

  await t.test("composer voice is hidden when SpeechRecognition is missing", async () => {
    const button = await readFile(
      new URL("../components/visual/ComposerVoiceButton.tsx", import.meta.url),
      "utf8",
    );
    const speech = await readFile(
      new URL("../lib/client/speech-input.ts", import.meta.url),
      "utf8",
    );
    assert.match(button, /speechRecognitionCtor/);
    assert.match(button, /if \(!supported\) return null/);
    assert.match(button, /zh-TW|createSpeechSession/);
    assert.match(button, /說完後按送出/);
    assert.match(button, /onReady/);
    assert.match(button, /onDenied/);
    assert.match(button, /heardRef/);
    assert.match(button, /if \(heardRef\.current\) onReady/);
    assert.doesNotMatch(button, /onFinal: \(text\) => \{\s*onChange[\s\S]*onReady/);
    assert.match(speech, /studentSpeechError/);
    assert.match(speech, /rec\.continuous = true/);
    assert.match(speech, /沒聽到語音。請靠近再試一次。/);
    const config = await readFile(
      new URL("../next.config.ts", import.meta.url),
      "utf8",
    );
    assert.match(config, /microphone=\(self\)/);
    assert.doesNotMatch(config, /microphone=\(\)/);
    assert.match(speech, /zh-TW/);
    assert.match(speech, /webkitSpeechRecognition/);
  });

  await t.test("workspace, health and tasks GET do not require a member session", async () => {
    assert.equal((await workspace.GET(request("workspace"))).status, 200);
    assert.equal((await health.GET(request("health"))).status, 200);
    assert.equal((await ready.GET(request("ready"))).status, 200);
    assert.equal((await tasks.GET(request("tasks"))).status, 200);
    assert.equal(
      (await credentials.GET(request("settings/credentials"))).status,
      200,
    );
    assert.equal((await memory.GET(request("memory"))).status, 200);
    assert.equal((await artifacts.GET(request("artifacts"))).status, 200);
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
