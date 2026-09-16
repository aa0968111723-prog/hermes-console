import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-finalization-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3310";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.XUNHE_MCP_URL = "https://xunhe.example/mcp";
process.env.LUMEN_MCP_URL = "https://lumen.example/api/mcp";
process.env.LUMEN_MCP_TOKEN = "l".repeat(32);
process.env.PLANFORM_MCP_URL = "https://planform.example/mcp";
process.env.TKU_MCP_URL = "https://tku.example/mcp";
process.env.TKU_MCP_TOKEN = "t".repeat(40);

process.env.ATLAS_MCP_URL = "https://atlas.example/api/mcp";
process.env.ATLAS_MCP_TOKEN = "a".repeat(32);

const { xunheStatus } = await import("../lib/server/xunhe");
const { lumenStatus } = await import("../lib/server/lumen");
const { planformStatus } = await import("../lib/server/planform");
const { publicMcpEntry, seedPublicRegistry, atlasStatus } = await import(
  "../lib/server/mcp-registry"
);
const { saveMemory, listMemories, memoriesForProject } = await import(
  "../lib/server/memory"
);
const {
  recordDesignRevision,
  restoreArtifact,
  forkArtifact,
  listArtifacts,
} = await import("../lib/server/artifacts");
const { put } = await import("../lib/server/store");
const mcpRegistryRoute = await import("../app/api/mcp-registry/route");

function request(path: string, method = "GET") {
  return new Request("http://localhost:3310/api/" + path, {
    method,
    headers: { Origin: process.env.CONSOLE_ORIGIN! },
  });
}

test("config-only MCP is awaiting verification, not partial", () => {
  assert.equal(xunheStatus().state, "awaiting_authorization");
  assert.equal(lumenStatus().state, "awaiting_authorization");
  assert.equal(planformStatus().state, "awaiting_authorization");
  assert.equal(atlasStatus().state, "awaiting_authorization");
  assert.doesNotMatch(xunheStatus().detail, /已列出工具/);
});

test("public MCP registry omits endpoint and schemas", async () => {
  const listed = await mcpRegistryRoute.GET(request("mcp-registry"));
  assert.equal(listed.status, 200);
  const body = await listed.json();
  assert.ok(Array.isArray(body.servers));
  for (const server of body.servers) {
    assert.equal(server.endpoint, undefined);
    assert.equal(server.credentialReference, undefined);
    assert.equal(server.inputSchema, undefined);
    if (server.tools?.[0])
      assert.equal(server.tools[0].inputSchema, undefined);
  }
  const publicRow = publicMcpEntry({
    id: "demo",
    name: "Demo",
    endpoint: "https://secret.example/mcp",
    transport: "streamable-http",
    authMode: "bearer",
    credentialReference: "SECRET_TOKEN",
    tools: [
      {
        name: "peek",
        description: "x",
        inputSchema: { type: "object" },
      },
    ],
    status: "partial",
    verifiedAt: null,
    lastError: null,
    readonly: true,
    trustedLevel: "external",
    enabled: true,
  });
  assert.equal("endpoint" in publicRow, false);
  assert.equal("credentialReference" in publicRow, false);
  assert.equal("inputSchema" in publicRow.tools[0], false);
  assert.ok(seedPublicRegistry().length >= 1);
});

test("project memory list does not mix in workspace notes", () => {
  put("project", "workspace", {
    id: "club",
    name: "社團",
    createdAt: new Date().toISOString(),
  });
  saveMemory("workspace", {
    kind: "note",
    title: "工作區備註",
    content: "不應出現在專案列表。",
    scope: "workspace",
  });
  saveMemory("workspace", {
    kind: "preference",
    title: "語氣",
    content: "使用繁體中文。",
    scope: "workspace",
  });
  saveMemory("workspace", {
    kind: "note",
    title: "專案備註",
    content: "只屬於社團。",
    scope: "club",
  });
  const projectOnly = listMemories("workspace", "club");
  assert.equal(projectOnly.length, 1);
  assert.equal(projectOnly[0].title, "專案備註");
  const mixed = memoriesForProject("workspace", "club");
  assert.equal(mixed.project.length, 1);
  assert.equal(mixed.workspacePrefs.length, 1);
  assert.equal(mixed.workspacePrefs[0].title, "語氣");
});

test("artifact revisions restore and fork the same design", () => {
  const first = recordDesignRevision("workspace", {
    projectId: "personal",
    workflowId: "a".repeat(64),
    design: { title: "茶會 V1" },
  });
  assert.equal(first.revisions.length, 1);
  const second = recordDesignRevision("workspace", {
    artifactId: first.id,
    projectId: "personal",
    workflowId: first.workflowId,
    design: { title: "茶會 V2" },
  });
  assert.equal(second.revisions.length, 2);
  assert.equal(
    second.revisions.find((item) => item.revisionId === second.currentRevisionId)
      ?.design.title,
    "茶會 V2",
  );
  const restored = restoreArtifact(
    "workspace",
    second.id,
    second.revisions[0].revisionId,
  );
  assert.equal(restored.revisions.length, 3);
  assert.equal(
    restored.revisions.at(-1)?.design.title,
    "茶會 V1",
  );
  const forked = forkArtifact("workspace", restored.id);
  assert.notEqual(forked.id, restored.id);
  assert.equal(forked.workflowId, null);
  assert.equal(forked.revisions[0].design.title, "茶會 V1");
  assert.ok(listArtifacts("workspace", "personal").length >= 2);
});

test("runtime inspector hides schemas until developer view", async () => {
  const ui = await readFile(
    new URL("../components/RuntimeInspector.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /開發者檢視/);
  assert.match(ui, /developer && \(/);
  assert.match(ui, /Hermes/);
  assert.match(ui, /StatusPill/);
  assert.match(ui, /developer=\{developer\}/);
});

test("artifact stage compare is side-by-side preview, not a pixel diff", async () => {
  const ui = await readFile(
    new URL("../components/visual/ArtifactStage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /比較/);
  assert.match(ui, /並排預覽，不是像素差異/);
});

test("idle task poll is slower than active poll", async () => {
  const ui = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /POLL_ACTIVE_MS = 3000/);
  assert.match(ui, /POLL_IDLE_MS = 8000/);
});

test("direction spec stays in the conversation that picked it, not the empty home", async () => {
  const ui = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /chatDirectionBrief/);
  assert.match(ui, /conversationId === activeId/);
  const welcome = ui.slice(
    ui.indexOf('aria-labelledby="welcome-title"'),
    ui.indexOf(") : ("),
  );
  assert.doesNotMatch(welcome, /DirectionBrief/);
  assert.match(ui, /setNotice\(""\)/);
});

test("direction brief shows tone and A4 label, not paper millimetre aspect", async () => {
  const brief = await readFile(
    new URL("../components/visual/DirectionBrief.tsx", import.meta.url),
    "utf8",
  );
  assert.match(brief, /\{COPY_LABEL\[id\]\}/);
  assert.match(brief, /\{format\.label\}/);
  assert.match(brief, /data-aspect=\{format\.aspect\}/);
  assert.doesNotMatch(brief, /\{format\.aspect\} ·/);
  assert.doesNotMatch(brief, />\{format\.aspect\}</);
});

test("student Agent dock is status, not Runtime or authorization copy", async () => {
  const consoleUi = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  const actions = await readFile(
    new URL("../components/visual/QuickActions.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(consoleUi, /Agent Runtime/);
  assert.doesNotMatch(consoleUi, /阻塞點/);
  assert.doesNotMatch(consoleUi, /如缺授權/);
  assert.match(consoleUi, /CONTINUE_SAME_WORK_PROMPT/);
  assert.doesNotMatch(actions, /若未授權/);
  assert.doesNotMatch(actions, /Canva/);
  const pill = consoleUi.slice(
    consoleUi.indexOf('className="connection-pill"'),
    consoleUi.indexOf('className="icon-button"', consoleUi.indexOf('connection-pill')),
  );
  assert.match(pill, /navigate\("agents"\)/);
  assert.doesNotMatch(pill, /setSettingsTab\("連線"\)/);
  const errors = await readFile(
    new URL("../lib/server/errors.ts", import.meta.url),
    "utf8",
  );
  assert.match(errors, /可以先找靈感/);
  assert.doesNotMatch(errors, /請到設定的連線頁/);
  const orbit = await readFile(
    new URL("../components/visual/AgentOrbit.tsx", import.meta.url),
    "utf8",
  );
  assert.match(orbit, /developer && chosen\.detail/);
  assert.match(orbit, /developer && \(/);
});
