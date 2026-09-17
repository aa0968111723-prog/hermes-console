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
  assert.match(ui, /allowDeveloper/);
  assert.match(ui, /inspect && snapshot/);
  assert.match(ui, /Hermes/);
  assert.match(ui, /StatusPill/);
  assert.match(ui, /developer=\{inspect\}/);
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

test("workspace GET failure after send keeps the open thread", async () => {
  const ui = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  const snapshot = await readFile(
    new URL("../lib/client/workspace-state.ts", import.meta.url),
    "utf8",
  );
  const boundary = await readFile(
    new URL("../components/ConsoleErrorBoundary.tsx", import.meta.url),
    "utf8",
  );
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(snapshot, /WORKSPACE_LOAD_NOTICE/);
  assert.match(snapshot, /mergeWorkspaceSnapshot/);
  assert.match(snapshot, /conversationWithTaskMessages/);
  assert.match(ui, /conversationWithTaskMessages/);
  assert.match(ui, /refresh\("poll"\)/);
  assert.match(ui, /sending\.current \|\| refreshing\.current/);
  assert.match(ui, /setAuth\("ready"\)/);
  assert.match(boundary, /繼續使用此工作區/);
  assert.ok(!page.includes("InvitationGate"));
  assert.doesNotMatch(snapshot, /HERMES_API_KEY|Bearer /);
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
  const deck = await readFile(
    new URL("../components/visual/ArtifactDeck.tsx", import.meta.url),
    "utf8",
  );
  assert.match(deck, /workflowPreviewDesign/);
});

test("direction brief shows tone and A4 label, not paper millimetre aspect", async () => {
  const brief = await readFile(
    new URL("../components/visual/DirectionBrief.tsx", import.meta.url),
    "utf8",
  );
  assert.match(brief, /\{COPY_LABEL\[id\]\}/);
  assert.match(brief, /studentFormatLabel\(format\.label\)/);
  assert.match(brief, /data-aspect=\{format\.aspect\}/);
  assert.doesNotMatch(brief, /\{format\.aspect\} ·/);
  assert.doesNotMatch(brief, />\{format\.aspect\}</);
  assert.doesNotMatch(brief, />\{format\.label\}</);
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
  assert.match(consoleUi, /allowDeveloper=\{runtimeOps\}/);
  assert.match(consoleUi, /顯示維運檢視/);
  assert.match(consoleUi, /說完了，請按送出/);
  assert.match(consoleUi, /composer-voice-hint/);
  assert.match(consoleUi, /onChange=\{setText\}/);
  assert.doesNotMatch(
    consoleUi,
    /onChange=\{\(next\) => \{\s*setText\(next\);\s*input\.current\?\.focus/,
  );
  assert.match(consoleUi, /studentTaskCaption\(currentTask\)/);
  assert.match(consoleUi, /progressSteps\(chosenTask\)/);
  assert.match(consoleUi, /onCancel=\{\(\) => closePanel\(\)\}/);
  assert.match(consoleUi, /e.target === e.currentTarget\) closePanel\(\)/);
  assert.match(consoleUi, />接下來</);
  assert.doesNotMatch(consoleUi, /<h3>執行計畫<\/h3>/);
  assert.doesNotMatch(consoleUi, /無法確認上游停止/);
  assert.doesNotMatch(consoleUi, /建立重試分支/);
  assert.doesNotMatch(consoleUi, /未宣稱遠端已停止/);
  assert.match(consoleUi, /再試一次（保留這次紀錄）/);
  assert.doesNotMatch(consoleUi, /currentTask\.events\.at\(-1\)\?\.summary/);
  assert.match(consoleUi, /進行狀況/);
  assert.doesNotMatch(consoleUi, /真實事件紀錄/);
  assert.doesNotMatch(
    consoleUi,
    /\{currentTask\.observationError && \(/,
  );
  assert.doesNotMatch(consoleUi, /setInspectDeveloper\(\(value\) => !value\)/);
  const settings = await readFile(
    new URL("../components/settings/ConnectionSettings.tsx", import.meta.url),
    "utf8",
  );
  assert.match(settings, /填寫網址與權杖/);
  assert.match(settings, /connection-ops/);
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
  assert.match(errors, /studentFacingSummary/);
  assert.match(errors, /任務輸入估計/);
  const tasks = await readFile(
    new URL("../lib/server/tasks.ts", import.meta.url),
    "utf8",
  );
  assert.match(tasks, /studentHermesError\(error\.message, error\.code\)/);
  assert.doesNotMatch(tasks, /服務日誌|原始會話|請至 Hermes|請檢查 Agent/);
  const taskRoute = await readFile(
    new URL("../app/api/tasks/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(taskRoute, /studentFacingTask/);
  const eventUi = await readFile(
    new URL("../components/visual/TaskEventSummary.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(eventUi, /event\.summary/);
  const orbit = await readFile(
    new URL("../components/visual/AgentOrbit.tsx", import.meta.url),
    "utf8",
  );
  assert.match(orbit, /developer && chosen\.detail/);
  assert.match(orbit, /developer && \(/);
});

test("student copy hides channel ids, provenance enums, and covers spoken lookup", async () => {
  const review = await readFile(
    new URL("../components/copywriting/CopyReviewCard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(review, /CHANNEL\[review\.channel\]/);
  assert.doesNotMatch(review, /\{review\.channel\}/);
  const board = await readFile(
    new URL("../components/inspiration/InspirationBoard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(board, /PROVENANCE_LABEL/);
  assert.doesNotMatch(board, /\{language\.live\.story\.provenance\}/);
  const twin = await readFile(
    new URL("../components/audience/FirstReactionBoard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(twin, /模擬 · /);
  assert.doesNotMatch(twin, /SIMULATION ·/);
  const reviewCard = await readFile(
    new URL("../components/visual/ImageReviewResult.tsx", import.meta.url),
    "utf8",
  );
  assert.match(reviewCard, /還沒讀圖/);
  assert.doesNotMatch(reviewCard, /未讀像素/);
  const inspirationCard = await readFile(
    new URL("../components/visual/InspirationResult.tsx", import.meta.url),
    "utf8",
  );
  assert.match(inspirationCard, /沒有已收藏來源 · 未搜全站/);
  assert.doesNotMatch(inspirationCard, /筆已收藏/);
  assert.doesNotMatch(inspirationCard, / · 低/);
  const ui = await readFile(new URL("./verify-ui.ts", import.meta.url), "utf8");
  assert.match(ui, /幫我查淡大禪學社茶會/);
  assert.match(ui, /社團資料/);
  assert.match(ui, /過程完成/);
  const entry = await readFile(new URL("./verify-entry.ts", import.meta.url), "utf8");
  assert.match(entry, /今天社博在哪/);
  assert.match(entry, /社團資料/);
  assert.match(entry, /不是即時/);
  assert.match(entry, /clubFacts\)\.toBeInViewport/);
  assert.match(entry, /幫我出圖/);
  assert.match(entry, /未出圖/);
  assert.match(entry, /onerror\?\.\(\{ error: "no-speech" \}\)/);
  assert.match(entry, /getByText\("說完了，請按送出"\)\)\.toBeVisible/);
  assert.match(entry, /not\.toBeFocused/);
  assert.match(entry, /api\/workflows/);
  assert.match(entry, /已選方向規格/);
  assert.match(entry, /Hermes 尚未連線，沒有出圖/);
  assert.match(entry, /工作區讀取失敗/);
});

test("spoken lookup pins club facts above the trailing spec", async () => {
  const visual = await readFile(
    new URL("../lib/client/conversation-visual.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    visual,
    /FOLLOWUP_VISUAL_SELECTOR = "\.knowledge-result, \.image-review"/,
  );
  assert.match(visual, /preferredPinnedVisual/);
  assert.match(visual, /preferBrief && pinBrief/);
  const consoleSource = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    consoleSource,
    /preferredPinnedVisual\([\s\S]*visualPinKey/,
  );
  assert.match(consoleSource, /taskEvents\(currentTask\)/);
  assert.doesNotMatch(consoleSource, /currentTask\?\.events/);
  const createConversation = consoleSource.slice(
    consoleSource.indexOf("async function createConversation"),
    consoleSource.indexOf("async function sendPrompt"),
  );
  assert.match(createConversation, /void loadWorkspace\(\)\.catch/);
  assert.doesNotMatch(createConversation, /await loadWorkspace\(\)/);
  const sendPrompt = consoleSource.slice(
    consoleSource.indexOf("async function sendPrompt"),
    consoleSource.indexOf("async function send()"),
  );
  assert.match(sendPrompt, /const spokenSend = voiceReady/);
  assert.match(sendPrompt, /shouldFocusComposerAfterSend\(spokenSend\)/);
  assert.match(sendPrompt, /applyDirectionBriefFromTask/);
  assert.match(sendPrompt, /setBusy\(false\);[\s\S]*await refresh\("user"\)/);
  assert.doesNotMatch(sendPrompt, /await refresh\("user"\)[\s\S]*input\.current\?\.focus/);
  assert.match(
    sendPrompt,
    /applyDirectionBriefFromTask[\s\S]*await refresh\("user"\)/,
  );
  const pick = consoleSource.slice(
    consoleSource.indexOf("async function pickInspirationDirection"),
    consoleSource.indexOf("async function stopTask"),
  );
  assert.match(pick, /readSelectedDirectionWorkflow/);
  assert.match(pick, /upsertWorkflow/);
  assert.match(pick, /void refresh\(\)/);
  assert.doesNotMatch(pick, /await refresh\(\)/);
  assert.doesNotMatch(consoleSource, /pinBriefAfterPick/);
  assert.match(consoleSource, /studentNoticeBarText/);
  assert.match(consoleSource, /shouldShowWorkspaceLoadNotice/);
  assert.match(consoleSource, /hasDirectionSpec/);
  assert.doesNotMatch(
    consoleSource,
    /error \|\|\s*\(offline \? OFFLINE_NOTICE : notice\)/,
  );
  const revise = await readFile(
    new URL("../lib/server/inspiration/revise.ts", import.meta.url),
    "utf8",
  );
  assert.match(revise, /isMakeSelectedPosterRequest/);
  assert.match(revise, /出圖/);
  assert.match(revise, /specRevisionKind/);
  assert.match(revise, /顏色\.\{0,8\}暖/);
  const activity = await readFile(
    new URL("../lib/client/activity.ts", import.meta.url),
    "utf8",
  );
  assert.match(activity, /WORKSPACE_RESULT_TOOLS/);
  assert.match(activity, /showComposerTask/);
  assert.match(activity, /showVisualProcessSummary/);
  assert.match(activity, /taskHasWorkspaceResult/);
  const visualMessage = await readFile(
    new URL("../components/visual/VisualMessage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(visualMessage, /showVisualProcessSummary\(task\)/);
  assert.doesNotMatch(visualMessage, /task\.error|服務日誌|工具授權/);
  const entry = await readFile(new URL("./verify-entry.ts", import.meta.url), "utf8");
  assert.match(entry, /過程完成/);
  assert.match(entry, /顏色改暖一點/);
  assert.match(entry, /重設密碼/);
  assert.match(entry, /登入 Hermes/);
  assert.doesNotMatch(
    entry.slice(entry.lastIndexOf("密碼登入")),
    /今天想做什麼？/,
  );
});

test("finalization audit tracks HEAD spoken POST-spec path and keeps ops docs", async () => {
  const audit = await readFile(
    new URL("../FINALIZATION_AUDIT.md", import.meta.url),
    "utf8",
  );
  assert.match(audit, /cursor\/workspace-load-keep-chat-cf7e/);
  assert.match(audit, /readSelectedDirectionWorkflow/);
  assert.match(audit, /applyDirectionBriefFromTask/);
  assert.match(audit, /workflowPreviewDesign/);
  assert.match(audit, /說完了，請按送出/);
  assert.match(audit, /實體 Android Chrome/);
  assert.match(audit, /#106／#107 保持關閉/);
  assert.doesNotMatch(audit, /cursor\/hermes-production-finalization-cf7e/);
  for (const name of [
    "PRODUCTION.md",
    "SECURITY.md",
    "ARCHITECTURE.md",
    "RELEASE_CHECKLIST.md",
  ]) {
    const doc = await readFile(
      new URL("../docs/" + name, import.meta.url),
      "utf8",
    );
    assert.ok(doc.length > 80, name + " missing");
  }
  const architecture = await readFile(
    new URL("../docs/ARCHITECTURE.md", import.meta.url),
    "utf8",
  );
  assert.match(architecture, /select POST/);
  assert.match(architecture, /不自動送出/);
  const checklist = await readFile(
    new URL("../docs/RELEASE_CHECKLIST.md", import.meta.url),
    "utf8",
  );
  assert.match(checklist, /說完了，請按送出/);
  assert.match(checklist, /GET \/api\/workflows/);
  assert.match(checklist, /同一 revision/);
});
