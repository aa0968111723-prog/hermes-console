import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-settings-authz-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3388";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_AUTH_MODE = "required";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";

const { registerEmail, loginEmail } = await import(
  "../lib/server/auth/providers/email"
);
const credentials = await import("../app/api/settings/credentials/route");
const galley = await import("../app/api/settings/galley/route");
const zeabur = await import("../app/api/settings/zeabur/route");
const workspace = await import("../app/api/workspace/route");
const { createSession } = await import("../lib/server/store");
const { hash } = await import("../lib/server/security");
const { settingsAccessWarning, zeaburAccessNotice } = await import(
  "../lib/server/auth/access-notice"
);

function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
) {
  return new Request("http://localhost:3388/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3388",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("required mode settings writes need owner or admin", async () => {
  assert.match(settingsAccessWarning(), /owner／admin/);
  assert.match(zeaburAccessNotice(), /owner／admin/);

  await registerEmail("owner@example.test", "correct-horse-battery");
  const owner = await loginEmail("owner@example.test", "correct-horse-battery");
  const ownerCookie = owner.header.split(";")[0];

  await registerEmail("member@example.test", "correct-horse-battery");
  const member = await loginEmail(
    "member@example.test",
    "correct-horse-battery",
  );
  const memberCookie = member.header.split(";")[0];

  const denied = await credentials.POST(
    request(
      "settings/credentials",
      "POST",
      { HERMES_MODEL: "blocked" },
      memberCookie,
    ),
  );
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.category, "PERMISSION_ERROR");

  const galleyDenied = await galley.POST(
    request("settings/galley", "POST", { action: "test" }, memberCookie),
  );
  assert.equal(galleyDenied.status, 403);

  const zeaburDenied = await zeabur.POST(
    request("settings/zeabur", "POST", { action: "test" }, memberCookie),
  );
  assert.equal(zeaburDenied.status, 403);

  const allowed = await credentials.GET(
    request("settings/credentials", "GET", undefined, ownerCookie),
  );
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.match(body.openSettingsWarning, /owner／admin/);
  assert.match(body.zeabur.notice, /owner／admin/);

  assert.equal(
    (await workspace.GET(request("workspace", "GET", undefined, ownerCookie)))
      .status,
    200,
  );
  assert.equal(
    (await workspace.GET(request("workspace", "GET", undefined, memberCookie)))
      .status,
    200,
  );

  const token = randomBytes(32).toString("hex");
  createSession(hash(token), "missing-user", Date.now() + 60_000);
  const orphan = await workspace.GET(
    request("workspace", "GET", undefined, "hermes_session=" + token),
  );
  assert.equal(orphan.status, 401);
  assert.equal((await orphan.json()).error.category, "AUTH_ERROR");
});
