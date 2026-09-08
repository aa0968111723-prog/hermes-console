import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-planform-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3235";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";
process.env.CONSOLE_MCP_SERVERS_JSON = "[]";
delete process.env.CONSOLE_VAULT_KEY;
delete process.env.PLANFORM_MCP_TOKEN;

const received: Array<{
  method?: string;
  id?: unknown;
  name?: string;
  session?: string | null;
}> = [];
const stub = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c as Buffer));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
      method?: string;
      id?: unknown;
      params?: { name?: string; arguments?: { utterance?: string } };
    };
    received.push({
      method: body.method,
      id: body.id,
      name: body.params?.name,
      session: typeof req.headers["mcp-session-id"] === "string"
        ? req.headers["mcp-session-id"]
        : null,
    });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("mcp-session-id", "sess-planform");
    if (body.method === "initialize") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "planform", version: "1.0.0" },
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
                name: "planform_run_agent",
                description: "口語場佈",
                inputSchema: { type: "object" },
              },
            ],
          },
        }),
      );
      return;
    }
    if (body.method === "tools/call" && body.params?.name === "planform_run_agent") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: "preview" }],
            structuredContent: {
              previewActive: true,
              unresolved: [],
              echo: body.params.arguments?.utterance,
            },
            isError: false,
          },
        }),
      );
      return;
    }
    if (body.method === "tools/call" && body.params?.name === "planform_confirm_preview") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            structuredContent: { previewActive: false, applied: true },
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
process.env.PLANFORM_MCP_URL = `http://127.0.0.1:${port}/mcp`;

const { githubIsNotMcp, seedRegistry, getMcp, probeMcp } = await import(
  "../lib/server/mcp-registry.ts"
);
const { invokePlanform, planformConfigured, planformStatus } = await import(
  "../lib/server/planform.ts"
);
const { toolsList, callTool } = await import("../lib/server/mcp.ts");

test("GitHub 倉庫不是 Planform MCP", () => {
  assert.equal(
    githubIsNotMcp("https://github.com/aa0968111723-prog/planform-iso"),
    true,
  );
  assert.equal(githubIsNotMcp(`http://127.0.0.1:${port}/mcp`), false);
});

test("設定 PLANFORM_MCP_URL 後自動列入核准清單", () => {
  assert.equal(planformConfigured(), true);
  assert.equal(planformStatus().state, "partial");
  const entry = seedRegistry().find((item) => item.id === "planform");
  assert.ok(entry);
  assert.equal(entry?.name, "Planform 場佈");
  assert.equal(entry?.readonly, false);
  assert.equal(entry?.credentialReference, null);
});

test("Workspace MCP 列出 planform_*，Hermes 可呼叫 planform_run_agent", async () => {
  const names = toolsList("workspace").map((tool) => tool.name);
  assert.ok(names.includes("planform_describe"));
  assert.ok(names.includes("planform_run_agent"));
  assert.ok(names.includes("planform_confirm_preview"));
  assert.ok(names.includes("workspace_save_directions"));

  const result = (await callTool("workspace", "planform_run_agent", {
    utterance: "幫我排 20 人社課，入口留一公尺，不要擋門",
  })) as {
    structuredContent?: { result?: { previewActive?: boolean; unresolved?: unknown[] } };
  };
  assert.equal(result.structuredContent?.result?.previewActive, true);
  assert.deepEqual(result.structuredContent?.result?.unresolved, []);
  assert.ok(received.some((r) => r.method === "initialize"));
  assert.ok(received.some((r) => r.name === "planform_run_agent"));
});

test("同一工作區沿用 MCP session，confirm_preview 作用在同一草稿", async () => {
  const confirmed = (await invokePlanform("planform_confirm_preview", {})) as {
    applied?: boolean;
  };
  assert.equal(confirmed.applied, true);
  const confirmCall = received.find((r) => r.name === "planform_confirm_preview");
  assert.equal(confirmCall?.session, "sess-planform");
});

test("probe 只做 initialize／tools/list", async () => {
  const entry = getMcp("planform");
  assert.ok(entry);
  const probed = await probeMcp(entry!);
  assert.equal(probed.status, "partial");
  assert.ok(probed.tools.some((tool) => tool.name === "planform_run_agent"));
});

test("連線設定頁可測試 Planform，且不含 GitHub 當端點", async () => {
  const ui = await readFile(
    new URL("../components/settings/ConnectionSettings.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /settings\/planform/);
  assert.match(ui, /PLANFORM_MCP_URL/);
  assert.match(ui, /測試 Planform 連線/);
  assert.doesNotMatch(ui, /github\.com\/aa0968111723-prog\/planform-iso/);
});

test.after(() => {
  stub.close();
});
