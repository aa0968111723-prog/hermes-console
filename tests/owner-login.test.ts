import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-owner-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3220";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
process.env.CONSOLE_REQUIRE_AUTH = "true";
process.env.CONSOLE_USERNAME = "owner";
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
process.env.CONSOLE_PASSWORD_HASH =
  "scrypt:" + salt + ":" + scryptSync(password, salt, 64).toString("hex");

const security = await import("../lib/server/security");
const workspace = await import("../app/api/workspace/route");
const authRoute = await import("../app/api/auth/route");

function request(path: string, method = "GET", body?: unknown, cookie = "") {
  return new Request("http://localhost:3220/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ownerCookie(value: string) {
  return "hermes_session=" + value;
}

test("single owner login gate", async (t) => {
  await t.test("enabled only when all three env set", () => {
    assert.equal(security.ownerLoginEnabled(), true);
  });

  await t.test("anonymous workspace access is rejected", async () => {
    assert.equal((await workspace.GET(request("workspace"))).status, 401);
  });

  await t.test("wrong password is rejected", async () => {
    const response = await authRoute.POST(
      request("auth", "POST", {
        action: "owner_login",
        username: "owner",
        password: "wrong-password",
      }),
    );
    assert.equal(response.status, 401);
  });

  await t.test("correct login issues cookie and grants access", async () => {
    const response = await authRoute.POST(
      request("auth", "POST", {
        action: "owner_login",
        username: "owner",
        password,
      }),
    );
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie") || "";
    const token = (cookie.match(/hermes_session=([a-f0-9]{64})/) || [])[1] || "";
    assert.ok(token);
    assert.equal(
      (await workspace.GET(request("workspace", "GET", undefined, ownerCookie(token)))).status,
      200,
    );
    assert.equal(
      (await authRoute.GET(request("auth", "GET", undefined, ownerCookie(token)))).status,
      200,
    );
  });

  await t.test("logout clears the session", async () => {
    const loginResponse = await authRoute.POST(
      request("auth", "POST", {
        action: "owner_login",
        username: "owner",
        password,
      }),
    );
    const cookie = loginResponse.headers.get("set-cookie") || "";
    const token = (cookie.match(/hermes_session=([a-f0-9]{64})/) || [])[1] || "";
    assert.ok(token);
    assert.equal(
      (
        await authRoute.DELETE(
          request("auth", "DELETE", undefined, ownerCookie(token)),
        )
      ).status,
      200,
    );
    assert.equal(
      (await workspace.GET(request("workspace", "GET", undefined, ownerCookie(token)))).status,
      401,
    );
  });
});
