import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-research-tool-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3320";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";

const { usableToolPayload, toolsList, callTool } = await import("../lib/server/mcp");

test("empty tool payloads are not success", () => {
  assert.equal(usableToolPayload({}), false);
  assert.equal(usableToolPayload(null), false);
  assert.equal(usableToolPayload("  "), false);
  assert.equal(usableToolPayload({ memories: [] }), true);
});

test("workspace_search_research is a read-only workspace tool", async () => {
  assert.ok(
    toolsList("workspace").some((item) => item.name === "workspace_search_research"),
  );
  const listed = toolsList("workspace").find(
    (item) => item.name === "workspace_search_research",
  );
  assert.equal(listed?.annotations?.readOnlyHint, true);
  const result = (await callTool("workspace", "workspace_search_research", {
    query: "CUDA Graph",
  })) as {
    structuredContent?: { result?: { nodes?: Array<{ title: string }> } };
    isError?: boolean;
  };
  assert.equal(result.isError, false);
  assert.ok((result.structuredContent?.result?.nodes?.length || 0) >= 1);
  const miss = (await callTool("workspace", "workspace_search_research", {
    query: "禪學社茶會海報靈感",
  })) as {
    structuredContent?: { result?: { nodes?: unknown[] } };
    isError?: boolean;
  };
  assert.equal(miss.isError, false);
  assert.equal(miss.structuredContent?.result?.nodes?.length, 0);
  const cacheIdentity = (await callTool("workspace", "workspace_search_research", {
    query: "multimodal cache identity processor policy",
  })) as {
    structuredContent?: { result?: { nodes?: Array<{ id: string }> } };
    isError?: boolean;
  };
  assert.equal(cacheIdentity.isError, false);
  assert.ok(
    (cacheIdentity.structuredContent?.result?.nodes || []).some((node) =>
      node.id.includes("2026-09-16-multimodal-cache-identity"),
    ),
  );
});
