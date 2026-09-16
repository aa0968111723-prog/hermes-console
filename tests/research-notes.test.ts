import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-research-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3340";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.CONSOLE_REQUIRE_GATEWAY = "false";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";

const {
  listResearchNodes,
  searchResearchNotes,
} = await import("../lib/server/research-notes");
const { assembleContext } = await import("../lib/server/context/assembler");
const { callTool, toolsList } = await import("../lib/server/mcp");

test("research notes are local nodes Hermes can search", () => {
  const nodes = listResearchNodes();
  assert.ok(nodes.length > 10);
  for (const node of nodes.slice(0, 5)) {
    assert.equal(node.confidence, "local_notes");
    assert.match(node.source, /^data\/ai-agent-research\//);
    assert.equal(node.relation, "repo_research_note");
    assert.ok(node.title.length > 0);
    assert.ok(node.finding.length > 0);
  }
  const hits = searchResearchNotes("Qwen2.5-VL visual token MRoPE", 5);
  assert.ok(hits.length >= 1);
  assert.match(hits[0].title + hits[0].finding, /Qwen|MRoPE|token/i);
  assert.equal(searchResearchNotes("禪學社茶會宣傳靈感", 5).length, 0);
});

test("tea-party context does not inject CUDA research notes", () => {
  const packed = assembleContext({
    owner: "workspace",
    projectId: "personal",
    goalText: "幫我找淡江禪學社茶會宣傳靈感",
  });
  assert.equal(
    packed.items.some((item) => item.source === "research_notes"),
    false,
  );
});

test("workspace_search_research_notes is a read-only MCP tool", async () => {
  const listed = toolsList("workspace").find(
    (tool) => tool.name === "workspace_search_research_notes",
  );
  assert.ok(listed);
  assert.equal(listed?.annotations.readOnlyHint, true);
  const result = await callTool("workspace", "workspace_search_research_notes", {
    query: "Qwen2.5-VL token geometry",
  });
  assert.equal(result.isError, false);
  const text = String((result.content as Array<{ text?: string }>)[0].text);
  assert.match(text, /本地研究筆記/);
  assert.match(text, /BEGIN_UNTRUSTED_DATA/);
  assert.doesNotMatch(text, /即時論文庫已搜尋/);
});
