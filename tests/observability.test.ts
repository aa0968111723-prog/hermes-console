import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatPlannerCatalog } from "../lib/server/orchestrator/catalog";
import { eventObservability, taskObservability } from "../lib/server/observability";

test("planner catalog exposes availability without secrets or endpoints", () => {
  const text = formatPlannerCatalog([
    {
      id: "galley",
      name: "GALLEY 研究情報",
      status: "partial",
      trustedLevel: "external",
      readonly: true,
      tools: [{ name: "galley_research" }, { name: "galley_intel" }],
      endpoint: "https://galley.example/mcp",
      credentialReference: "GALLEY_MCP_TOKEN",
    },
    {
      id: "lumen",
      name: "Lumen 創作台",
      status: "unconfigured",
      trustedLevel: "external",
      endpoint: "https://lumen.example/mcp",
      credentialReference: "LUMEN_MCP_TOKEN",
    },
  ]);
  assert.match(text, /status=partial/);
  assert.match(text, /availability=usable/);
  assert.match(text, /permission=read/);
  assert.match(text, /galley_research/);
  assert.match(text, /cost=unknown/);
  assert.match(text, /lumen[\s\S]*不可用，不要呼叫/);
  assert.doesNotMatch(text, /https:\/\//);
  assert.doesNotMatch(text, /GALLEY_MCP_TOKEN|LUMEN_MCP_TOKEN/);
  assert.doesNotMatch(text, /inputSchema|"properties"/);
});

test("task observability ids are stable workspace-scoped fields", () => {
  const ids = taskObservability({
    taskId: "11111111-1111-1111-1111-111111111111",
    conversationId: "22222222-2222-2222-2222-222222222222",
    projectId: "personal",
  });
  assert.equal(ids.taskId, "11111111-1111-1111-1111-111111111111");
  assert.equal(ids.conversationId, "22222222-2222-2222-2222-222222222222");
  assert.equal(ids.workspaceId, "workspace");
  assert.equal(ids.projectId, "personal");
  assert.match(ids.traceId, /^[0-9a-f-]{36}$/);
  assert.notEqual(ids.traceId, ids.taskId);
});

test("tool event latency and failed category are derived, not invented", () => {
  const done = eventObservability({
    startedAt: "2026-09-16T00:00:00.000Z",
    endedAt: "2026-09-16T00:00:01.250Z",
    status: "completed",
    error: null,
  });
  assert.equal(done.latencyMs, 1250);
  assert.equal(done.errorCategory, null);

  const failed = eventObservability({
    startedAt: "2026-09-16T00:00:00.000Z",
    endedAt: "2026-09-16T00:00:00.400Z",
    status: "failed",
    error: "工具失敗",
  });
  assert.equal(failed.latencyMs, 400);
  assert.equal(failed.errorCategory, "UNKNOWN");
});

test("task sheet keeps trace ids in technical details, not the chat summary", async () => {
  const sheet = await readFile(
    new URL("../components/console/TaskSheet.tsx", import.meta.url),
    "utf8",
  );
  const chat = await readFile(
    new URL("../components/visual/VisualMessage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(sheet, /task-technical/);
  assert.match(sheet, /task\.traceId/);
  assert.match(sheet, /task\.projectId/);
  assert.match(sheet, /e\.latencyMs/);
  assert.doesNotMatch(chat, /traceId/);
});
