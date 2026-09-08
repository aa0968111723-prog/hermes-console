import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// Actual HTTP and MCP protocol contracts against isolated local fixtures.
// This is NOT a live Hermes/Zeabur or external MCP execution test.
process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-runtime-sync-"),
);
process.env.HERMES_API_KEY = randomBytes(32).toString("hex");
process.env.MCP_BRIDGE_TOKEN = randomBytes(32).toString("hex");
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.CONSOLE_MCP_SERVERS_JSON = "[]";
let toolNames = ["web_search"],
  modelsStatus = 200,
  toolsetsStatus = 200,
  malformed = false,
  modelRequests = 0;
const upstream = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models") {
    modelRequests++;
    res.statusCode = modelsStatus;
    return void res.end(JSON.stringify({ data: [{ id: "hermes-fixture" }] }));
  }
  if (req.url === "/v1/capabilities")
    return void res.end(
      JSON.stringify({
        object: "hermes.api_server.capabilities",
        features: { run_submission: true, memory: true, responses_api: true },
      }),
    );
  if (req.url === "/v1/skills")
    return void res.end(
      JSON.stringify([{ name: "brand-writing", description: "Brand writing" }]),
    );
  if (req.url === "/v1/toolsets") {
    res.statusCode = toolsetsStatus;
    return void res.end(
      JSON.stringify(
        malformed
          ? { invalid: true }
          : [
              {
                name: "web",
                description: "Search the web",
                enabled: true,
                tools: toolNames,
              },
            ],
      ),
    );
  }
  res.writeHead(404).end();
});
let mcpStatus = 200,
  mcpNames = ["search"],
  schemaType = "string",
  mcpRequests = 0;
const mcp = createServer(async (req, res) => {
  if (req.method !== "POST") return void res.writeHead(405).end();
  let body = "";
  for await (const part of req) body += part;
  const message = JSON.parse(body || "{}");
  if (message.method === "notifications/initialized")
    return void res.writeHead(202).end();
  res.setHeader("Content-Type", "application/json");
  if (mcpStatus !== 200) return void res.writeHead(mcpStatus).end("{}");
  if (message.method === "initialize")
    return void res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "runtime-mcp", version: "1" },
        },
      }),
    );
  if (message.method === "tools/list") {
    mcpRequests++;
    return void res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: mcpNames.map((name) => ({
            name,
            description: "Fixture read hint is not authority",
            annotations: { readOnlyHint: true },
            inputSchema: {
              type: "object",
              properties: { query: { type: schemaType } },
            },
            outputSchema: { type: "object" },
          })),
        },
      }),
    );
  }
  res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
});
await Promise.all([
  new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve)),
  new Promise<void>((resolve) => mcp.listen(0, "127.0.0.1", resolve)),
]);
after(() => {
  for (const server of [upstream, mcp]) {
    server.closeAllConnections();
    server.close();
  }
});
process.env.HERMES_API_URL =
  "http://127.0.0.1:" + (upstream.address() as { port: number }).port;
const endpoint = "http://127.0.0.1:" + (mcp.address() as { port: number }).port;
process.env.CONSOLE_MCP_SERVERS_JSON = JSON.stringify([
  { id: "alpha", name: "Alpha", endpoint },
  { id: "beta", name: "Beta", endpoint },
]);
const manager = await import("../lib/server/hermes/sync-manager");
const { get, put, list } = await import("../lib/server/store");
const { callTool } = await import("../lib/server/mcp");
const { runtimeStream } = await import("../lib/server/hermes/runtime-stream");
const sync = () => manager.syncRuntime("workspace", { force: true });

test("unchanged discoveries keep hash, schema record and diff stable; concurrent requests are single-flight", async () => {
  const first = await sync();
  const record = JSON.stringify(
    get("runtime_snapshot", "workspace", "current"),
  );
  assert.equal(first.responsesSupport, "available");
  assert.equal(first.sessionsSupport, "unknown");
  assert.deepEqual(
    first.tools.find((t) => t.canonicalName === "mcp.alpha.search")
      ?.permissions,
    ["confirm"],
  );
  assert.ok(
    first.tools.find((t) => t.canonicalName === "mcp.beta.search")
      ?.outputSchema,
  );
  assert.ok(
    first.tools.every(
      (t) => t.lastVerifiedAt === null && t.status !== "available",
    ),
  );
  const n = modelRequests;
  const results = await Promise.all(Array.from({ length: 20 }, sync));
  assert.equal(modelRequests - n, 1);
  assert.ok(results.every((result) => result.hash === first.hash));
  assert.equal(
    JSON.stringify(get("runtime_snapshot", "workspace", "current")),
    record,
  );
  assert.equal(list("runtime_diff", "workspace").length, 1);
  assert.notEqual(
    manager.runtimeSnapshot("workspace")?.fetchedAt,
    first.fetchedAt,
  );
});

test("add/remove/schema changes use namespace and no timestamp-only tool diff", async () => {
  const first = await sync();
  toolNames = ["new_search"];
  schemaType = "number";
  const second = await sync(),
    diff = manager.runtimeDiff(first, second);
  assert.deepEqual(diff.added, ["hermes.web.new_search"]);
  assert.deepEqual(diff.removed, ["hermes.web.web_search"]);
  assert.deepEqual(diff.changed.sort(), [
    "mcp.alpha.search",
    "mcp.beta.search",
  ]);
  assert.ok(diff.becameUnavailable.includes("hermes.web.web_search"));
});

test("bad credentials retain stale native tools but MCP additions keep synchronizing, then recover", async () => {
  const before = await sync();
  modelsStatus = 401;
  mcpNames = ["search", "new_tool"];
  const n = mcpRequests,
    stale = await sync();
  assert.equal(stale.status, "stale");
  assert.notEqual(stale.hash, before.hash);
  assert.ok(
    stale.tools
      .filter((t) => t.source === "hermes-native")
      .every((t) => t.status === "stale"),
  );
  assert.ok(
    stale.tools.some(
      (t) => t.canonicalName === "mcp.alpha.new_tool" && t.status === "partial",
    ),
  );
  assert.ok(mcpRequests > n);
  assert.ok(
    !manager
      .runtimeTools("workspace")
      .some((t) => t.source === "hermes-native"),
  );
  modelsStatus = 200;
  assert.ok(
    manager
      .runtimeDiff(stale, await sync())
      .recovered.includes("hermes.web.new_search"),
  );
});

test("malformed lists are failures, not empty success; unsupported endpoint removes native tools", async () => {
  malformed = true;
  const failed = await sync();
  assert.equal(failed.discovery?.toolsets, "failed");
  assert.ok(
    failed.tools.some(
      (t) => t.source === "hermes-native" && t.status === "stale",
    ),
  );
  malformed = false;
  toolsetsStatus = 404;
  const unsupported = await sync();
  assert.equal(unsupported.discovery?.toolsets, "unsupported");
  assert.ok(!unsupported.tools.some((t) => t.source === "hermes-native"));
  toolsetsStatus = 200;
});

test("MCP outage retains last-known schemas as stale; recovery and disable update truthfully", async () => {
  const { setMcpEnabled } = await import("../lib/server/mcp-registry");
  mcpStatus = 503;
  const failed = await sync();
  assert.ok(
    failed.tools
      .filter((t) => t.source === "mcp")
      .every((t) => t.status === "stale"),
  );
  mcpStatus = 200;
  const recovered = await sync();
  assert.ok(
    manager
      .runtimeDiff(failed, recovered)
      .recovered.includes("mcp.alpha.search"),
  );
  setMcpEnabled("alpha", false);
  const disabled = await sync();
  assert.equal(
    disabled.mcpServers.find((s) => s.id === "alpha")?.enabled,
    false,
  );
  assert.ok(!disabled.tools.some((t) => t.sourceServer === "alpha"));
});

test("binding blocks actual MCP execution and cannot claim unsupported native enforcement", async () => {
  await sync();
  const input = {
    projectId: "personal",
    toolName: "console-workspace.workspace_project_context",
    enabled: false,
    priority: 0,
    allowedTools: [],
    blockedTools: [],
    permissionOverrides: {},
  };
  const conversationId = randomUUID(),
    taskId = randomUUID();
  put("conversation", "workspace", {
    id: conversationId,
    projectId: "personal",
    messages: [],
  });
  put("task", "workspace", {
    id: taskId,
    conversationId,
    state: "running",
    events: [],
  });
  manager.saveRuntimeBinding("workspace", input);
  const blocked = await callTool("workspace", "workspace_project_context", {
    taskId,
    projectId: "personal",
  });
  assert.equal(blocked.isError, true);
  assert.match(JSON.stringify(blocked), /tool_binding_denied/);
  assert.throws(
    () =>
      manager.saveRuntimeBinding("workspace", {
        ...input,
        toolName: "hermes.web.new_search",
      }),
    /原生/,
  );
  assert.throws(
    () =>
      manager.saveRuntimeBinding("workspace", {
        ...input,
        permissionOverrides: { write: "read" },
      }),
    /覆寫/,
  );
  manager.saveRuntimeBinding("workspace", { ...input, enabled: true });
  assert.equal(
    (
      await callTool("workspace", "workspace_project_context", {
        taskId,
        projectId: "personal",
      })
    ).isError,
    false,
  );
});

test("SSE shares discovery across clients, recovers missed IDs, heartbeats and closes on authorization loss", async () => {
  await sync();
  const n = modelRequests,
    readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  let authorized = true;
  try {
    for (let i = 0; i < 5; i++) {
      const response = runtimeStream(
        new Request("http://console.test", {
          headers: { "Last-Event-ID": "missed" },
        }),
        "workspace",
        () => {
          if (!authorized) throw new Error("denied");
        },
        30,
      );
      readers.push(response.body!.getReader());
      assert.match(
        new TextDecoder().decode((await readers[i].read()).value),
        /runtime.reset/,
      );
      assert.match(
        new TextDecoder().decode((await readers[i].read()).value),
        /runtime.snapshot/,
      );
    }
    assert.match(
      new TextDecoder().decode((await readers[0].read()).value),
      /heartbeat/,
    );
    assert.equal(modelRequests, n, "subscribers must not each force discovery");
    const waiting = readers[0].read();
    toolNames = ["live_added"];
    await sync();
    assert.match(new TextDecoder().decode((await waiting).value), /live_added/);
    authorized = false;
    while (!(await readers[0].read()).done) {
      /* Drain bounded queued events. */
    }
  } finally {
    await Promise.all(readers.map((reader) => reader.cancel()));
  }
});

test("expired persisted snapshot fails closed after restart-age and missing bridge never appears enabled", async () => {
  process.env.MCP_BRIDGE_TOKEN = "";
  const current = await sync();
  assert.ok(
    current.tools
      .filter((t) => t.source === "console-workspace")
      .every((t) => !t.enabled && t.status === "unknown"),
  );
  const meta = get<Record<string, unknown>>(
    "runtime_sync",
    "workspace",
    "current",
  )!;
  put("runtime_sync", "workspace", {
    ...meta,
    id: "current",
    fetchedAt: new Date(Date.now() - 600_000).toISOString(),
  });
  assert.equal(manager.runtimeSnapshot("workspace")?.status, "stale");
  assert.equal(manager.runtimeTools("workspace").length, 0);
});
