import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-mcp-contract-"),
);
process.env.CONSOLE_ORIGIN = "https://console.example";
process.env.MCP_BRIDGE_TOKEN = randomBytes(32).toString("hex");
process.env.CONSOLE_VAULT_KEY = randomBytes(32).toString("hex");
const routes = await import("../app/api/mcp/route");
const { get, put } = await import("../lib/server/store");
const { seal, unseal } = await import("../lib/server/vault");
const { startCanvaAuth, completeCanvaAuth } = await import(
  "../lib/server/canva"
);
const { chooseDirection, createDraft, pollDraft } = await import(
  "../lib/server/workflows"
);
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const part of req) chunks.push(part);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers))
    if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
  const request = new Request("http://localhost/api/mcp", {
    method: req.method,
    headers,
    body: req.method === "POST" ? Buffer.concat(chunks).toString() : undefined,
  });
  const response = await (req.method === "POST"
    ? routes.POST(request)
    : routes.GET(request));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = new URL(
  "http://127.0.0.1:" + (server.address() as { port: number }).port,
);
const client = new Client({ name: "isolated-contract-client", version: "1" });
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: {
    headers: { Authorization: "Bearer " + process.env.MCP_BRIDGE_TOKEN },
  },
});
const realFetch = globalThis.fetch;
let autofills = 0;
test("real MCP client contract and Canva adapter contracts (not live Canva)", async (t) => {
  await t.test(
    "independent bridge authorization rejects public clients",
    async () => {
      assert.equal(
        (
          await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
        401,
      );
    },
  );
  await client.connect(transport);
  await t.test(
    "SDK negotiates HTTP protocol; unavailable Canva tools not advertised",
    async () => {
      const result = await client.listTools();
      assert.ok(
        result.tools.some((t) => t.name === "workspace_save_directions"),
      );
      assert.ok(!result.tools.some((t) => t.name.startsWith("canva_")));
      assert.ok(
        !result.tools.some((t) => /publish|post_instagram/.test(t.name)),
      );
    },
  );
  let workflowId = "";
  await t.test(
    "directions persist through an actual MCP tool call; duplicate calls reuse result",
    async () => {
      const args = {
        projectId: "personal",
        brief: "契約測試活動，不是真實創作案例",
        directions: [1, 2, 3].map((i) => ({
          title: "契約方向 " + i,
          claim: "測試主張",
          visual: "測試視覺",
          copy: "測試文案",
          cta: "測試 CTA",
          sources: ["https://hermes-agent.nousresearch.com/docs/"],
        })),
      };
      const first = await client.callTool({
        name: "workspace_save_directions",
        arguments: args,
      });
      const text = (first.content as Array<{ text: string }>)[0].text;
      workflowId = JSON.parse(text).id;
      assert.equal(
        get<{ state: string }>("workflow", "workspace", workflowId)?.state,
        "awaiting_selection",
      );
      const again = await client.callTool({
        name: "workspace_save_directions",
        arguments: args,
      });
      assert.equal(
        JSON.parse((again.content as Array<{ text: string }>)[0].text).id,
        workflowId,
      );
    },
  );
  await t.test(
    "agent cannot select a direction through MCP; owner selection is required",
    async () => {
      await assert.rejects(() =>
        client.callTool({
          name: "choose_direction",
          arguments: { id: workflowId, selected: 0 },
        }),
      );
      await assert.rejects(
        () =>
          createDraft("workspace", {
            workflowId,
            fields: { TITLE: { type: "text", text: "test" } },
          }),
        /選定/,
      );
      chooseDirection("workspace", workflowId, 0);
      await assert.rejects(
        () =>
          createDraft("workspace", {
            workflowId,
            fields: { TITLE: { type: "text", text: "test" } },
          }),
        /Template/,
      );
      assert.equal(
        get<{ state: string }>("workflow", "workspace", workflowId)?.state,
        "waiting_authorization",
      );
    },
  );
  await t.test(
    "OAuth PKCE uses state and private verifier; vault is authenticated encryption",
    async () => {
      process.env.CANVA_CLIENT_ID = "contract-client";
      process.env.CANVA_CLIENT_SECRET = randomBytes(32).toString("hex");
      const auth = startCanvaAuth("owner", "contract-session");
      const query = new URL(auth.url).searchParams;
      assert.equal(query.get("code_challenge_method"), "S256");
      assert.ok(!auth.url.includes("verifier"));
      await assert.rejects(
        () =>
          completeCanvaAuth(
            "owner",
            "invalid-state",
            "contract-code",
            () => true,
          ),
        /授權狀態/,
      );
      const secret = { value: randomBytes(20).toString("hex") },
        encrypted = seal(secret);
      assert.ok(!encrypted.includes(secret.value));
      assert.deepEqual(unseal(encrypted), secret);
      const parts = encrypted.split(".");
      parts[1] = "0".repeat(32);
      assert.throws(() => unseal(parts.join(".")));
    },
  );
  await t.test(
    "Canva HTTP contract: selected autofill sends real fields; concurrent calls submit once",
    async () => {
      // Only the fixed official Canva origin is intercepted in this isolated test.
      globalThis.fetch = async (input, init) => {
        const address = String(input);
        if (!address.startsWith("https://api.canva.com/"))
          return realFetch(input, init);
        if (address.endsWith("/dataset"))
          return Response.json({ dataset: { TITLE: { type: "text" } } });
        if (address.endsWith("/autofills")) {
          autofills++;
          assert.equal(
            JSON.parse(String(init?.body)).data.TITLE.text,
            "contract title",
          );
          await new Promise((r) => setTimeout(r, 30));
          return Response.json({ job: { id: "contract_job" } });
        }
        if (address.endsWith("/autofills/contract_job"))
          return Response.json({
            job: {
              status: "success",
              result: {
                design: {
                  id: "contract_design",
                  url: "https://www.canva.com/design/contract_design/edit",
                },
              },
            },
          });
        throw new Error("Unexpected contract endpoint");
      };
      process.env.CANVA_BRAND_TEMPLATE_ID = "contract_template";
      put("canva_tokens", "workspace", {
        id: "current",
        ciphertext: seal({
          access_token: randomBytes(20).toString("hex"),
          refresh_token: "contract-refresh",
          expiresAt: Date.now() + 3_600_000,
          scope: "contract",
        }),
      });
      const input = {
        workflowId,
        fields: { TITLE: { type: "text" as const, text: "contract title" } },
      };
      await Promise.all([
        createDraft("workspace", input),
        createDraft("workspace", input),
      ]);
      assert.equal(autofills, 1);
      const done = await pollDraft("workspace", workflowId);
      assert.equal(done.state, "draft_ready");
      assert.equal(done.design?.id, "contract_design");
      await createDraft("workspace", input);
      assert.equal(autofills, 1);
    },
  );
});
test.after(async () => {
  globalThis.fetch = realFetch;
  await client.close();
  server.closeAllConnections();
  server.close();
});
