import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-framelab-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3235";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
delete process.env.CONSOLE_VAULT_KEY;

const received: Array<{ method?: string; id?: unknown; name?: string; auth?: string }> = [];
const stub = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c as Buffer));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
      method?: string;
      id?: unknown;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    received.push({
      method: body.method,
      id: body.id,
      name: body.params?.name,
      auth: typeof req.headers.authorization === "string" ? req.headers.authorization : undefined,
    });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("mcp-session-id", "sess-framelab");
    if (body.method === "initialize") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "FrameLab", version: "0.4.0" },
          },
        }),
      );
      return;
    }
    if (body.method?.startsWith("notifications/")) {
      res.writeHead(202).end();
      return;
    }
    if (body.method === "tools/list") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "list_projects",
                description: "List projects",
                inputSchema: { type: "object" },
                annotations: { readOnlyHint: true, destructiveHint: false },
              },
            ],
          },
        }),
      );
      return;
    }
    if (body.method === "tools/call" && body.params?.name === "list_projects") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: "{\"ok\":true,\"projects\":[{\"id\":\"prj_1\"}]}" }],
            structuredContent: { ok: true, projects: [{ id: "prj_1", name: "馬桶超人" }] },
            isError: false,
          },
        }),
      );
      return;
    }
    if (body.method === "tools/call" && body.params?.name === "create_project") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: "{\"ok\":true,\"id\":\"prj_2\"}" }],
            structuredContent: {
              ok: true,
              id: "prj_2",
              timelineId: "tl_2",
              name: body.params.arguments?.name || "未命名動畫",
              projectId: "prj_2",
            },
            isError: false,
          },
        }),
      );
      return;
    }
    if (body.method === "tools/call" && body.params?.name === "generate_inbetweens") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            structuredContent: { ok: true, jobId: "job_1", candidate: true },
            isError: false,
          },
        }),
      );
      return;
    }
    if (body.method === "tools/call" && body.params?.name === "get_timeline") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            structuredContent: { ok: true, data: { id: "tl_2", frames: [{ frame_number: 0 }] } },
            isError: false,
          },
        }),
      );
      return;
    }
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { message: "unexpected" } }));
  });
});
await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
const port = (stub.address() as { port: number }).port;
process.env.FRAMELAB_MCP_URL = `http://127.0.0.1:${port}/api/mcp`;
process.env.FRAMELAB_MCP_TOKEN = "fl_hermes_contract_token_aaaa";

const { githubIsNotMcp, configuredMcp } = await import("../lib/server/mcp-registry.ts");
const { invokeFramelab, framelabConfigured, isFramelabTool, flattenFramelabPayload } = await import("../lib/server/framelab.ts");
const { toolsList } = await import("../lib/server/mcp.ts");

test("GitHub 倉庫不是 FrameLab MCP", () => {
  assert.equal(githubIsNotMcp("https://github.com/aa0968111723-prog/hermes-console"), true);
  assert.equal(githubIsNotMcp("https://github.com/aa0968111723-prog/FrameLab"), true);
  assert.equal(githubIsNotMcp(`http://127.0.0.1:${port}/api/mcp`), false);
});

test("FRAMELAB_MCP_URL 自動進入核准清單且 id 為 framelab", () => {
  const configs = configuredMcp();
  const entry = configs.find((c) => c.id === "framelab");
  assert.ok(entry);
  assert.equal(entry?.readonly, false);
  assert.equal(entry?.credentialReference, "FRAMELAB_MCP_TOKEN");
  assert.match(entry?.endpoint || "", /\/api\/mcp$/);
});

test("設定後 Hermes 可經工作區 MCP 呼叫 FrameLab", async () => {
  assert.equal(framelabConfigured(), true);
  assert.equal(isFramelabTool("framelab_list_projects"), true);
  assert.equal(isFramelabTool("framelab_create_sample_project"), true);
  assert.equal(isFramelabTool("framelab_generate_inbetweens"), true);
  assert.equal(isFramelabTool("framelab_accept_generated_frames"), true);
  const listed = toolsList("workspace");
  assert.ok(listed.some((t) => t.name === "framelab_list_projects"));
  assert.ok(listed.some((t) => t.name === "framelab_call"));
  assert.ok(listed.some((t) => t.name === "framelab_create_sample_project"));
  assert.ok(listed.some((t) => t.name === "framelab_generate_inbetweens"));
  const gen = listed.find((t) => t.name === "framelab_generate_inbetweens");
  assert.equal(gen?.annotations?.readOnlyHint, false);
  assert.equal(gen?.annotations?.destructiveHint, true);

  const result = await invokeFramelab("framelab_list_projects", {});
  assert.equal(result.ok, true);
  assert.equal((result.projects as Array<{ id: string }>)[0]?.id, "prj_1");
  assert.ok(received.some((r) => r.method === "initialize"));
  assert.ok(received.some((r) => r.method === "notifications/initialized" && r.id === undefined));
  assert.ok(received.some((r) => r.name === "list_projects"));
  assert.ok(received.every((r) => !r.auth || r.auth === "Bearer fl_hermes_contract_token_aaaa"));

  const created = await invokeFramelab("framelab_create_project", { name: "馬桶超人" });
  assert.equal(created.id, "prj_2");
  assert.equal(created.timelineId, "tl_2");

  const generated = await invokeFramelab("framelab_generate_inbetweens", {
    timelineId: "tl_2",
    confirmed: true,
  });
  assert.equal(generated.jobId, "job_1");
  assert.ok(received.some((r) => r.name === "generate_inbetweens"));

  const wrapped = await invokeFramelab("framelab_get_timeline", { timelineId: "tl_2" });
  assert.equal(wrapped.id, "tl_2");
  assert.equal("data" in wrapped, false);
  assert.ok(Array.isArray(wrapped.frames));
});

test("flattenFramelabPayload 把舊的 {ok,data} 攤平給 Hermes", () => {
  const listed = flattenFramelabPayload({ ok: true, data: [{ id: "prj_1" }] });
  assert.equal((listed.projects as Array<{ id: string }>)[0]?.id, "prj_1");
  const created = flattenFramelabPayload({ ok: true, data: { id: "prj_2", timelineId: "tl_2" } });
  assert.equal(created.id, "prj_2");
  const already = flattenFramelabPayload({ ok: true, projects: [{ id: "x" }] });
  assert.equal((already.projects as Array<{ id: string }>)[0]?.id, "x");
});

test.after(() => {
  stub.close();
});
