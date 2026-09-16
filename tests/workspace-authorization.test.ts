import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSession } from "./session-fixture";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-authz-"));
const owner = seedSession(process.env.CONSOLE_DATA_DIR, "owner");
const member = seedSession(process.env.CONSOLE_DATA_DIR, "member");
const admin = seedSession(process.env.CONSOLE_DATA_DIR, "admin");
process.env.CONSOLE_TEST_SESSION = owner.token;
process.env.CONSOLE_ORIGIN = "http://localhost:3291";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";

const credentials = await import("../app/api/settings/credentials/route");
const tamkang = await import("../app/api/settings/tamkang/route");
const zeabur = await import("../app/api/settings/zeabur/route");
const mcpRegistry = await import("../app/api/mcp-registry/route");
const runtime = await import("../app/api/runtime/route");
const canva = await import("../app/api/canva/route");
const bindings = await import("../app/api/runtime/bindings/route");
const workspace = await import("../app/api/workspace/route");
const { authenticate, authenticateOperator } = await import(
  "../lib/server/security"
);
const { requireWorkspaceRole } = await import("../lib/server/identity");
const { taxonomyFor } = await import("../lib/server/errors");

function request(
  path: string,
  cookie: string,
  method = "GET",
  body?: unknown,
) {
  return new Request("http://localhost:3291/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("workspace members cannot change connection secrets", async () => {
  assert.equal(taxonomyFor("permission_denied"), "PERMISSION_ERROR");
  assert.equal(
    authenticate(request("workspace", owner.cookie)),
    "workspace",
  );
  assert.equal(
    authenticate(request("workspace", member.cookie)),
    "workspace",
  );
  assert.equal(
    authenticateOperator(request("settings/credentials", owner.cookie)),
    "workspace",
  );
  assert.equal(
    authenticateOperator(request("settings/credentials", admin.cookie)),
    "workspace",
  );
  assert.throws(
    () => authenticateOperator(request("settings/credentials", member.cookie)),
    /管理者權限/,
  );
  assert.equal(
    requireWorkspaceRole(request("auth", member.cookie), ["member"]).membership
      .role,
    "member",
  );
  assert.throws(
    () =>
      requireWorkspaceRole(request("auth", member.cookie), ["owner", "admin"]),
    /管理者權限/,
  );

  const memberGet = await credentials.GET(
    request("settings/credentials", member.cookie),
  );
  assert.equal(memberGet.status, 403);
  const denied = await memberGet.json();
  assert.equal(denied.error.code, "permission_denied");
  assert.equal(denied.error.taxonomy, "PERMISSION_ERROR");
  assert.match(denied.error.message, /管理者權限/);

  const memberPost = await credentials.POST(
    request("settings/credentials", member.cookie, "POST", {
      HERMES_API_KEY: "member-must-not-write-this-key",
    }),
  );
  assert.equal(memberPost.status, 403);

  assert.equal(
    (
      await tamkang.POST(
        request("settings/tamkang", member.cookie, "POST", { action: "test" }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await zeabur.POST(
        request("settings/zeabur", member.cookie, "POST", { action: "test" }),
      )
    ).status,
    403,
  );
  const memberMcp = await mcpRegistry.GET(
    request("mcp-registry", member.cookie),
  );
  assert.equal(memberMcp.status, 200);
  const memberMcpBody = await memberMcp.json();
  assert.equal(memberMcpBody.view, "normal");
  const memberDump = JSON.stringify(memberMcpBody);
  assert.doesNotMatch(memberDump, /credentialReference/);
  assert.doesNotMatch(memberDump, /inputSchema/);
  assert.doesNotMatch(memberDump, /https?:\/\//);
  assert.doesNotMatch(memberDump, /MCP_BRIDGE|HERMES_API_KEY|_MCP_TOKEN/);
  assert.ok(
    (memberMcpBody.servers as Array<Record<string, unknown>>).every(
      (row) =>
        row.endpoint === undefined &&
        row.tools === undefined &&
        row.lastError === null,
    ),
  );

  const ownerMcp = await mcpRegistry.GET(
    request("mcp-registry", owner.cookie),
  );
  assert.equal(ownerMcp.status, 200);
  const ownerMcpBody = await ownerMcp.json();
  assert.equal(ownerMcpBody.view, "developer");
  assert.ok(
    (ownerMcpBody.servers as Array<{ endpoint?: string }>).some(
      (row) => typeof row.endpoint === "string",
    ),
  );

  const memberRuntime = await runtime.GET(request("runtime", member.cookie));
  assert.equal(memberRuntime.status, 200);
  const memberSnap = await memberRuntime.json();
  const memberRuntimeDump = JSON.stringify(memberSnap);
  assert.doesNotMatch(memberRuntimeDump, /hermesKeySource/);
  assert.ok(
    (
      memberSnap.snapshot.tools as Array<{
        canonicalName?: string;
        inputSchema?: Record<string, unknown>;
      }>
    ).every(
      (tool) =>
        !tool.canonicalName && Object.keys(tool.inputSchema || {}).length === 0,
    ),
  );

  const ownerRuntime = await runtime.GET(request("runtime", owner.cookie));
  assert.equal(ownerRuntime.status, 200);
  const ownerSnap = await ownerRuntime.json();
  assert.ok("hermesKeySource" in (ownerSnap.snapshot.diagnostics || {}));

  assert.equal(
    (
      await mcpRegistry.POST(
        request("mcp-registry", member.cookie, "POST", {
          id: "rogue",
          name: "rogue",
          endpoint: "https://example.test/mcp",
        }),
      )
    ).status,
    403,
  );
  assert.equal((await canva.GET(request("canva", member.cookie))).status, 200);
  assert.equal(
    (
      await canva.POST(
        request("canva", member.cookie, "POST", { action: "authorize" }),
      )
    ).status,
    403,
  );
  assert.equal(
    (await bindings.GET(request("runtime/bindings", member.cookie))).status,
    200,
  );
  assert.equal(
    (
      await bindings.POST(
        request("runtime/bindings", member.cookie, "POST", {
          projectId: "personal",
          toolName: "workspace_list_copy",
          enabled: false,
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (await workspace.GET(request("workspace", member.cookie))).status,
    200,
  );

  assert.equal(
    (
      await credentials.GET(request("settings/credentials", admin.cookie))
    ).status,
    200,
  );
  const ownerGet = await credentials.GET(
    request("settings/credentials", owner.cookie),
  );
  assert.equal(ownerGet.status, 200);
  const published = await ownerGet.json();
  assert.match(published.openSettingsWarning, /擁有者或管理者/);
  assert.ok(!JSON.stringify(published).includes("member-must-not-write"));
});
