import test from "node:test";
import assert from "node:assert/strict";
import { toolsList, callTool, bridgeAuth } from "../lib/server/mcp.ts";
import { MCP_TOOLS, executeMcpTool } from "../lib/server/mcp/registry.ts";
import { seedRegistry } from "../lib/server/mcp-registry.ts";
import { GET as getProtectedResource } from "../app/.well-known/oauth-protected-resource/[[...path]]/route.ts";
import { GET as getAuthServer } from "../app/.well-known/oauth-authorization-server/[[...path]]/route.ts";
import { ApiError } from "../lib/server/security.ts";

test("Phase 13 Gemini Spark MCP tools and OAuth discovery metadata", async (t) => {
  await t.test("RFC 9728 OAuth Protected Resource metadata endpoint", async () => {
    const req = new Request("https://344.zeabur.app/.well-known/oauth-protected-resource");
    const res = await getProtectedResource(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.resource.includes("/api/mcp"));
    assert.ok(Array.isArray(data.authorization_servers));
    assert.ok(data.scopes_supported.includes("inspiration:read"));
    assert.ok(data.scopes_supported.includes("inspiration:write"));
    assert.ok(data.scopes_supported.includes("mcp:tools"));
    assert.ok(Array.isArray(data.bearer_methods_supported));
  });

  await t.test("RFC 8414 OAuth Authorization Server metadata endpoint", async () => {
    const req = new Request("https://344.zeabur.app/.well-known/oauth-authorization-server");
    const res = await getAuthServer(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.issuer);
    assert.ok(data.authorization_endpoint);
    assert.ok(Array.isArray(data.response_types_supported));
    assert.ok(Array.isArray(data.grant_types_supported));
  });

  await t.test("bridgeAuth returns WWW-Authenticate with resource_metadata on 401", () => {
    const req = new Request("https://344.zeabur.app/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    assert.throws(
      () => bridgeAuth(req),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 401);
        assert.equal(err.code, "bridge_unauthorized");
        assert.ok(err.headers["WWW-Authenticate"]);
        assert.ok(err.headers["WWW-Authenticate"].includes("resource_metadata="));
        return true;
      },
    );
  });

  await t.test("lib/server/mcp toolsList includes inspiration tools with truthful annotations", () => {
    const tools = toolsList("workspace");
    const toolNames = tools.map((t) => t.name);
    assert.ok(toolNames.includes("inspiration_list"));
    assert.ok(toolNames.includes("inspiration_ingest"));
    assert.ok(toolNames.includes("inspiration_search"));

    const listTool = tools.find((t) => t.name === "inspiration_list");
    assert.equal(listTool?.annotations.readOnlyHint, true);
    assert.equal(listTool?.annotations.idempotentHint, true);

    const ingestTool = tools.find((t) => t.name === "inspiration_ingest");
    assert.equal(ingestTool?.annotations.readOnlyHint, false);
    assert.equal(ingestTool?.annotations.destructiveHint, false);
  });

  await t.test("lib/server/mcp callTool handles inspiration workflow end-to-end", async () => {
    // 1. Ingest
    const rawIngested = await callTool("workspace", "inspiration_ingest", {
      url: "https://www.instagram.com/p/spark_sample_123/",
      projectId: "personal",
      caption: "Gemini Spark 靈感板測試文案",
      account: "spark_creator",
    });
    assert.equal(rawIngested.isError, false);
    const ingested = JSON.parse(rawIngested.content[0].text);

    assert.equal(ingested.ingested, true);
    assert.ok(ingested.item);
    assert.ok(ingested.item.sourceUrl.includes("spark_sample_123"));

    // 2. List
    const rawListed = await callTool("workspace", "inspiration_list", {
      projectId: "personal",
    });
    assert.equal(rawListed.isError, false);
    const listed = JSON.parse(rawListed.content[0].text);

    assert.ok(listed.count > 0);
    assert.ok(listed.items.some((i: any) => i.sourceUrl.includes("spark_sample_123")));

    // 3. Search
    const rawSearched = await callTool("workspace", "inspiration_search", {
      prompt: "淡江大學禪學社迎新茶會靈感",
      projectId: "personal",
    });
    assert.equal(rawSearched.isError, false);
    const searched = JSON.parse(rawSearched.content[0].text);

    assert.ok(searched.prompt);
    assert.ok(Array.isArray(searched.fixtures));
    assert.ok(searched.notice);
  });

  await t.test("lib/server/mcp/registry MCP_TOOLS and executeMcpTool support inspiration tools", async () => {
    const registeredNames = MCP_TOOLS.map((t) => t.name);
    assert.ok(registeredNames.includes("inspiration_list"));
    assert.ok(registeredNames.includes("inspiration_ingest"));
    assert.ok(registeredNames.includes("inspiration_search"));

    // 1. Ingest via executeMcpTool
    const ingestRes = await executeMcpTool("inspiration_ingest", {
      url: "https://pinterest.com/pin/spark_pin_789/",
      projectId: "personal",
      caption: "極簡社團茶席設計",
    });
    assert.equal(ingestRes.success, true);
    assert.equal((ingestRes.result as any).ingested, true);

    // 2. List via executeMcpTool
    const listRes = await executeMcpTool("inspiration_list", {
      projectId: "personal",
    });
    assert.equal(listRes.success, true);
    assert.ok((listRes.result as any).count > 0);

    // 3. Search via executeMcpTool
    const searchRes = await executeMcpTool("inspiration_search", {
      prompt: "極簡日式茶會",
      projectId: "personal",
    });
    assert.equal(searchRes.success, true);
    assert.ok((searchRes.result as any).fixtures);
    assert.ok((searchRes.result as any).notice);
  });

  await t.test("seedRegistry provides workspace inspiration tools baseline", () => {
    const seeded = seedRegistry();
    const ws = seeded.find((e) => e.id === "workspace");
    assert.ok(ws);
    const wsToolNames = ws?.tools.map((t) => t.name) || [];
    assert.ok(wsToolNames.includes("inspiration_list"));
    assert.ok(wsToolNames.includes("inspiration_ingest"));
    assert.ok(wsToolNames.includes("inspiration_search"));
  });
});
