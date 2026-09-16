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
const integrations = await import("../app/api/integrations/route");
const agents = await import("../app/api/agents/route");
const usage = await import("../app/api/usage/route");
const certification = await import("../app/api/certification/route");
const runtimeTools = await import("../app/api/runtime/tools/route");
const runtimeMcp = await import("../app/api/runtime/mcp/route");
const runtimeAgents = await import("../app/api/runtime/agents/route");
const healthRoute = await import("../app/api/health/route");
const { presentHealth } = await import("../lib/server/hermes/health-view");
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
  const memberInt = await integrations.GET(
    request("integrations", member.cookie),
  );
  assert.equal(memberInt.status, 200);
  const memberIntBody = await memberInt.json();
  assert.equal(memberIntBody.view, "normal");
  const memberIntDump = JSON.stringify(memberIntBody);
  assert.doesNotMatch(
    memberIntDump,
    /TKU_MCP_|GALLEY_MCP_|XUNHE_MCP_|PLANFORM_MCP_|LUMEN_MCP_|FRAMELAB_MCP_|DUIGAO_MCP_|HERMES_API_|MCP_BRIDGE|_MCP_TOKEN|_MCP_URL/,
  );
  assert.ok(
    (
      memberIntBody.integrations as Array<{
        tools?: string[];
        requirements?: string[];
        detail?: string;
        evidence?: string | null;
      }>
    ).every(
      (row) =>
        Array.isArray(row.tools) &&
        row.tools.length === 0 &&
        Array.isArray(row.requirements) &&
        row.requirements.length === 0 &&
        row.detail === "" &&
        row.evidence === null,
    ),
  );
  assert.equal(memberIntBody.canva.message, "");

  const ownerInt = await integrations.GET(
    request("integrations", owner.cookie),
  );
  assert.equal(ownerInt.status, 200);
  const ownerIntBody = await ownerInt.json();
  assert.equal(ownerIntBody.view, "developer");
  assert.ok(
    (ownerIntBody.integrations as Array<{ requirements?: string[] }>).some(
      (row) =>
        (row.requirements || []).some((value) => /HERMES_API_|_MCP_/.test(value)),
    ),
  );

  const memberAgents = await agents.GET(request("agents", member.cookie));
  assert.equal(memberAgents.status, 200);
  const memberAgentsBody = await memberAgents.json();
  assert.equal(memberAgentsBody.view, "normal");
  assert.doesNotMatch(JSON.stringify(memberAgentsBody), /HERMES_API_KEY|_API_KEY/);
  assert.ok(
    (
      memberAgentsBody.agents as Array<{
        tools?: string[];
        credentialReference?: string;
        skills?: unknown[];
      }>
    ).every(
      (row) =>
        Array.isArray(row.tools) &&
        row.tools.length === 0 &&
        row.credentialReference === "" &&
        Array.isArray(row.skills) &&
        row.skills.length === 0,
    ),
  );

  const ownerAgents = await agents.GET(request("agents", owner.cookie));
  assert.equal(ownerAgents.status, 200);
  const ownerAgentsBody = await ownerAgents.json();
  assert.equal(ownerAgentsBody.view, "developer");
  assert.ok(
    (ownerAgentsBody.agents as Array<{ credentialReference?: string }>).some(
      (row) => /HERMES_/.test(String(row.credentialReference || "")),
    ),
  );

  assert.equal((await canva.GET(request("canva", member.cookie))).status, 200);
  const memberCanva = await (
    await canva.GET(request("canva", member.cookie))
  ).json();
  assert.equal(memberCanva.message, "");
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
    403,
  );
  assert.equal((await usage.GET(request("usage", member.cookie))).status, 403);
  assert.equal(
    (await certification.GET(request("certification", member.cookie))).status,
    403,
  );
  assert.equal(
    (
      await certification.POST(
        request("certification", member.cookie, "POST", { action: "run" }),
      )
    ).status,
    403,
  );
  assert.equal(
    (await runtimeTools.GET(request("runtime/tools", member.cookie))).status,
    403,
  );
  assert.equal(
    (await runtimeMcp.GET(request("runtime/mcp", member.cookie))).status,
    403,
  );
  assert.equal(
    (await runtimeAgents.GET(request("runtime/agents", member.cookie))).status,
    403,
  );
  assert.equal(
    (
      await agents.POST(
        request("agents", member.cookie, "POST", { refresh: true }),
      )
    ).status,
    403,
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

  const memberHealth = await healthRoute.GET(
    request("health", member.cookie),
  );
  assert.equal(memberHealth.status, 200);
  const memberHealthBody = await memberHealth.json();
  assert.equal(memberHealthBody.live, true);
  assert.equal(memberHealthBody.configSource, undefined);
  assert.deepEqual(memberHealthBody.models, []);
  assert.deepEqual(memberHealthBody.skills, []);
  assert.deepEqual(memberHealthBody.toolsets, []);
  assert.doesNotMatch(
    JSON.stringify(memberHealthBody),
    /hermesKey|HERMES_API_KEY|_MCP_TOKEN/,
  );

  const ownerHealth = await healthRoute.GET(request("health", owner.cookie));
  assert.equal(ownerHealth.status, 200);
  const ownerHealthBody = await ownerHealth.json();
  assert.ok(ownerHealthBody.configSource);
  assert.equal(ownerHealthBody.configSource.hermesKey, "none");

  assert.equal(
    (
      await healthRoute.POST(request("health", member.cookie, "POST", {}))
    ).status,
    403,
  );
  assert.equal(
    (
      await healthRoute.POST(request("health", owner.cookie, "POST", {}))
    ).status,
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

test("public health probe strips tool names and credential sources", () => {
  const sample = {
    checkedAt: "2026-01-01T00:00:00.000Z",
    reachable: true,
    credential: "valid" as const,
    agent: "verified" as const,
    status: "partial" as const,
    message: "憑證已通過模型清單驗證。",
    httpStatus: 200,
    features: { sessions: true },
    models: ["fixture-agent"],
    skills: [{ name: "research", description: "搜尋", tools: ["web_search"] }],
    toolsets: [{ name: "tku", description: "campus", tools: ["getToDo"] }],
    discovery: { toolsets: "available" as const },
    configSource: { hermesUrl: "env" as const, hermesKey: "vault" as const },
    backend: "sqlite" as const,
    dataDir: "/tmp/console",
    storeReady: true,
  };
  const publicView = presentHealth(sample, false);
  assert.equal(publicView.configSource, undefined);
  assert.deepEqual(publicView.models, []);
  assert.deepEqual(publicView.skills, []);
  assert.deepEqual(publicView.toolsets, []);
  assert.deepEqual(publicView.features, {});
  assert.equal(publicView.httpStatus, null);
  assert.equal(publicView.storeReady, true);
  const operatorView = presentHealth(sample, true);
  assert.equal(operatorView.configSource?.hermesKey, "vault");
  assert.ok(operatorView.models.includes("fixture-agent"));
  assert.ok(
    operatorView.toolsets.some((item) => item.tools?.includes("getToDo")),
  );

  const leaked = presentHealth(
    {
      ...sample,
      credential: "invalid",
      status: "failed",
      message: "Hermes 金鑰無效或已撤銷，請在後端更換。",
    },
    false,
  );
  assert.equal(leaked.message, "Hermes 還沒連上。請到設定的連線頁。");
  assert.doesNotMatch(leaked.message, /金鑰|後端|環境變數/);
});
