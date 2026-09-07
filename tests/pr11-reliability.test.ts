import test from "node:test";
import { seedSession } from "./session-fixture";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Task } from "../lib/contracts";
import sharp from "sharp";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-pr11-"));
process.env.CONSOLE_ORIGIN = "https://console.example";
process.env.CONSOLE_GATEWAY_SECRET = randomBytes(32).toString("hex");
const secret = process.env.CONSOLE_GATEWAY_SECRET;
const security = await import("../lib/server/security");
const workspace = await import("../app/api/workspace/route");
const intelligence = await import("../app/api/intelligence/route");
const registry = await import("../lib/server/mcp-registry");
const inspiration = await import("../lib/server/inspiration");
const { dedupeInspiration } = await import("../lib/server/inspiration/dedupe");
const { get, list, put } = await import("../lib/server/store");
const { taskFor } = await import("../lib/server/tasks");
const { callTool } = await import("../lib/server/mcp");
const { saveUpload } = await import("../lib/server/materials");
const { recordTaskUsage, aggregateUsage } = await import("../lib/server/usage");
const req = (
  body?: unknown,
  gateway = secret,
  origin = process.env.CONSOLE_ORIGIN!,
) =>
  new Request(process.env.CONSOLE_ORIGIN + "/api/intelligence", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: seedSession().cookie,
      Origin: origin,
      "Content-Type": "application/json",
      "X-Console-Gateway": gateway,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("gateway is fail-closed and cannot be replaced by Origin or forwarded identity", async () => {
  assert.equal((await workspace.GET(req(undefined, ""))).status, 401);
  assert.equal((await workspace.GET(req(undefined, "forged"))).status, 401);
  assert.equal((await workspace.GET(req())).status, 200);
  assert.equal(
    (
      await intelligence.POST(
        req({ prompt: "x" }, secret, "https://attacker.example"),
      )
    ).status,
    403,
  );
  process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
  process.env.CONSOLE_REQUIRE_GATEWAY = "true";
  delete process.env.CONSOLE_GATEWAY_SECRET;
  assert.equal((await workspace.GET(req())).status, 503);
  const spoofed = new Request("https://console.example/api/workspace", {
    headers: {
      Host: "localhost",
      "X-Forwarded-Host": "localhost",
      "X-Forwarded-For": "127.0.0.1",
      "X-Auth-User": "admin",
    },
  });
  assert.equal((await workspace.GET(spoofed)).status, 503);
  process.env.CONSOLE_GATEWAY_SECRET = secret;
  assert.equal(security.redact(secret), "[redacted]");
  delete process.env.CONSOLE_GATEWAY_SECRET;
  process.env.CONSOLE_ORIGIN = "http://127.0.0.1:3315";
  assert.doesNotThrow(() =>
    security.verifyGateway(new Request("http://localhost:3315/api/workspace")),
  );
  assert.throws(
    () =>
      security.verifyGateway(
        new Request("http://localhost:9999/api/workspace"),
      ),
    /閘道/,
  );
  process.env.CONSOLE_GATEWAY_SECRET = secret;
  process.env.CONSOLE_ORIGIN = "https://console.example";
});

test("MCP cannot pair a client-selected URL with a backend secret", () => {
  process.env.CONSOLE_MCP_SERVERS_JSON = JSON.stringify([
    {
      id: "approved",
      name: "Approved read source",
      endpoint: "https://approved.example/mcp",
      credentialReference: "APPROVED_MCP_TOKEN",
    },
  ]);
  assert.throws(
    () =>
      registry.registerMcp({
        id: "unlisted",
        name: "x",
        endpoint: "https://attacker.example/mcp",
        credentialReference: "HERMES_API_KEY",
      }),
    /核准/,
  );
  assert.throws(
    () =>
      registry.registerMcp({
        id: "approved",
        name: "x",
        endpoint: "https://attacker.example/mcp",
      }),
    /符合/,
  );
  assert.throws(
    () =>
      registry.registerMcp({
        id: "approved",
        name: "x",
        credentialReference: "HERMES_API_KEY",
      }),
    /符合/,
  );
  const valid = registry.registerMcp({ id: "approved", name: "x" });
  assert.equal(valid.status, "unconfigured");
  assert.equal(valid.endpoint, "https://approved.example/mcp");
  delete process.env.CONSOLE_MCP_SERVERS_JSON;
  assert.equal(registry.getMcp("approved")?.status, "unconfigured");
  assert.equal(registry.getMcp("approved")?.endpoint, "");
  assert.equal(
    registry.interpretVerification({
      initialize: false,
      toolsList: true,
      safeRead: true,
    }),
    "failed",
  );
});

test("inspiration identities preserve different links and project scopes, with no invented analysis", () => {
  put("project", "workspace", { id: "second", name: "Second" });
  const a = inspiration.ingestUrl({
    projectId: "personal",
    url: "https://www.instagram.com/p/long-common-prefix-A",
  });
  const b = inspiration.ingestUrl({
    projectId: "personal",
    url: "https://www.instagram.com/p/long-common-prefix-B",
  });
  const elsewhere = inspiration.ingestUrl({
    projectId: "second",
    url: a.sourceUrl,
  });
  const retry = inspiration.ingestUrl({
    projectId: "personal",
    url: a.sourceUrl + "?utm_source=fixture",
  });
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, elsewhere.id);
  assert.equal(retry.id, a.id);
  assert.equal(inspiration.listInspiration("personal").length, 2);
  assert.equal(dedupeInspiration([a, b]).length, 2);
  assert.deepEqual(a.borrow, []);
  assert.throws(
    () => inspiration.ingestUrl({ projectId: "missing", url: a.sourceUrl }),
    /專案/,
  );
  assert.throws(
    () =>
      inspiration.ingestUrl({
        projectId: "personal",
        url: a.sourceUrl,
        caption: secret,
      }),
    /憑證/,
  );
  process.env.INSTAGRAM_CLIENT_ID = "configured-id";
  process.env.INSTAGRAM_CLIENT_SECRET = "configured-but-not-authorized";
  assert.equal(inspiration.instagramResearchLimits().authorizedApi, false);
});

test("intelligence performs real HTTP submission, preserves references and task results, deduplicates retries (contract server)", async () => {
  const calls: Array<{ path: string; body: any }> = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    calls.push({ path: request.url!, body: raw ? JSON.parse(raw) : null });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/v1/models")
      response.end(
        JSON.stringify({ data: [{ id: "isolated-contract-model" }] }),
      );
    else if (request.url === "/v1/capabilities")
      response.end(
        JSON.stringify({
          object: "hermes.api_server.capabilities",
          features: { chat_completions: true },
        }),
      );
    else if (request.url === "/v1/skills" || request.url === "/v1/toolsets")
      response.end("[]");
    else if (request.url === "/v1/chat/completions") {
      response.setHeader("Content-Type", "text/event-stream");
      response.end(
        "data: " +
          JSON.stringify({
            model: "isolated-contract-model",
            choices: [
              {
                delta: {
                  content:
                    "CONTRACT ONLY: genuine HTTP result, missing activity date and location.",
                },
              },
            ],
            usage: {
              prompt_tokens: 17,
              completion_tokens: 9,
              total_tokens: 26,
            },
          }) +
          "\n\ndata: [DONE]\n\n",
      );
    } else response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.HERMES_API_URL =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  process.env.HERMES_API_KEY = randomBytes(32).toString("hex");
  process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
  try {
    const payload = {
      prompt: "幫我做台大攝影展，時間地點尚未確定",
      projectId: "personal",
      requestKey: randomUUID(),
    };
    assert.equal((await intelligence.POST(req(payload, ""))).status, 401);
    assert.equal(calls.length, 0);
    const response = await intelligence.POST(req(payload));
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.ok(result.task.id && result.conversationId);
    let settled: Task = result.task;
    for (let i = 0; i < 100; i++) {
      settled = taskFor("workspace", result.task.id);
      if (["completed", "failed", "uncertain"].includes(settled.state)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(settled.state, "completed");
    assert.match(settled.output, /^CONTRACT ONLY/);
    assert.equal(settled.usage.totalTokens, 26);
    const generation = calls.find((c) => c.path === "/v1/chat/completions")!;
    assert.ok(JSON.stringify(generation.body).includes(payload.prompt));
    assert.ok(JSON.stringify(generation.body).includes("long-common-prefix-A"));
    assert.ok(!JSON.stringify(generation.body).includes(secret));
    assert.ok(!settled.output.includes("週三傍晚"));
    const retry = await (await intelligence.POST(req(payload))).json();
    assert.equal(retry.task.id, result.task.id);
    assert.equal(
      calls.filter((c) => c.path === "/v1/chat/completions").length,
      1,
    );
    assert.equal(
      (await intelligence.POST(req({ ...payload, prompt: "changed" }))).status,
      409,
    );
    assert.equal(list("intelligence_request", "workspace").length, 1);
    const conv = get<{ messages: Array<{ content: string }> }>(
      "conversation",
      "workspace",
      result.conversationId,
    )!;
    assert.ok(conv.messages.some((m) => m.content === settled.output));
    recordTaskUsage(settled, { projectId: "personal" });
    recordTaskUsage(settled, { projectId: "personal" });
    assert.equal(aggregateUsage().totalTokens, 26);
    assert.equal(aggregateUsage().toolCalls, null);
    assert.equal(aggregateUsage().cost, null);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("MCP requires an active task, enforces project/budget, emits actual image content and actionable authorization failures", async () => {
  process.env.MCP_REQUIRE_TASK_CONTEXT = "true";
  process.env.CONSOLE_MAX_TOOL_CALLS = "40";
  const missing = await callTool("workspace", "workspace_list_references", {
    projectId: "personal",
  });
  assert.ok(
    missing.isError &&
      JSON.stringify(missing).includes("task_context_required"),
  );
  const old = list<Task>("task", "workspace")[0];
  const id = randomUUID();
  put("task", "workspace", {
    ...old,
    id,
    requestKey: randomUUID(),
    state: "running",
    events: [],
    output: "",
  } satisfies Task);
  const bytes = await sharp({
    create: { width: 3, height: 2, channels: 4, background: "#356b45" },
  })
    .png()
    .toBuffer();
  const asset = await saveUpload(
    "workspace",
    "personal",
    "actual-fixture.png",
    "image/png",
    bytes,
  );
  const image = await callTool(
    "workspace",
    "workspace_read_material",
    { materialId: asset.id, taskId: id, toolCallId: "real-call-image" },
    17,
  );
  assert.equal(image.isError, false);
  const imageBlock = image.content.find((item) => item.type === "image");
  assert.ok(imageBlock && "data" in imageBlock && typeof imageBlock.data === "string");
  const decoded = await sharp(
    Buffer.from(imageBlock.data, "base64"),
  ).metadata();
  assert.equal(decoded.width, 3);
  assert.equal(decoded.height, 2);
  const saved = taskFor("workspace", id).events[0];
  assert.equal(saved.toolCallId, "real-call-image");
  assert.ok(!JSON.stringify(saved.result).includes("imageData"));
  const crossed = await callTool("workspace", "workspace_list_references", {
    projectId: "second",
    taskId: id,
  });
  assert.ok(crossed.isError && JSON.stringify(crossed).includes("tool_scope"));
  const canva = await callTool("workspace", "canva_search_designs", {
    query: "fixture",
    taskId: id,
  });
  assert.ok(
    canva.isError &&
      JSON.stringify(canva).includes("canva_authorization_required"),
  );
  assert.equal(
    taskFor("workspace", id).events.at(-1)?.status,
    "waiting_authorization",
  );
  process.env.CONSOLE_MAX_TOOL_CALLS = "1";
  const budget = await callTool("workspace", "workspace_list_references", {
    projectId: "personal",
    taskId: id,
  });
  assert.ok(
    budget.isError && JSON.stringify(budget).includes("tool_budget_exceeded"),
  );
  assert.equal(taskFor("workspace", id).events.at(-1)?.retryable, false);
  put("task", "workspace", { ...taskFor("workspace", id), state: "cancelled" });
  process.env.CONSOLE_MAX_TOOL_CALLS = "40";
  const stopped = await callTool("workspace", "workspace_read_material", {
    materialId: asset.id,
    taskId: id,
  });
  assert.ok(
    stopped.isError && JSON.stringify(stopped).includes("task_not_active"),
  );
});
