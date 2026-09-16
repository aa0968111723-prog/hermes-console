import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-inspiration-agent-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3331";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";

const { toolsList, callTool } = await import("../lib/server/mcp");
const { assembleContext, formatContextForInstructions } = await import(
  "../lib/server/context/assembler"
);
const { ingestUrl } = await import("../lib/server/inspiration");

test("workspace_search_inspiration is clustered patterns, not Instagram-wide search", async () => {
  ingestUrl({
    url: "https://www.instagram.com/p/Dc0jgihkyFV/",
    projectId: "personal",
    caption: "社博來文館左側晃晃 #淡江",
    account: "tku_zc",
  });
  assert.ok(
    toolsList("workspace").some(
      (item) => item.name === "workspace_search_inspiration",
    ),
  );
  const listed = toolsList("workspace").find(
    (item) => item.name === "workspace_search_inspiration",
  );
  assert.equal(listed?.annotations?.readOnlyHint, true);
  const result = (await callTool("workspace", "workspace_search_inspiration", {
    query: "幫我找淡大禪學社茶會宣傳靈感",
  })) as {
    structuredContent?: {
      result?: {
        fullSiteSearch?: boolean;
        instagramConnected?: boolean;
        notice?: string;
        references?: Array<{ sourceUrl: string }>;
        visualLanguage?: {
          keep?: Array<{ title: string }>;
          avoid?: Array<{ title: string }>;
          biggestProblem?: string;
        };
      };
    };
    isError?: boolean;
  };
  assert.equal(result.isError, false);
  const brief = result.structuredContent?.result;
  assert.equal(brief?.fullSiteSearch, false);
  assert.equal(brief?.instagramConnected, false);
  assert.match(brief?.notice || "", /不是 Instagram/);
  assert.ok((brief?.visualLanguage?.keep?.length || 0) >= 1);
  assert.match(
    (brief?.visualLanguage?.keep || []).map((item) => item.title).join(" "),
    /龜龜|淡江|插畫/,
  );
  assert.doesNotMatch(JSON.stringify(brief), /已搜尋整個 Instagram|全站已搜尋/);
  const packed = assembleContext({
    owner: "workspace",
    projectId: "personal",
    goalText: "幫我找淡大禪學社茶會宣傳靈感",
    budgetMode: "balanced",
  });
  const direction = packed.items.find(
    (item) => item.source === "creative_direction",
  );
  assert.ok(direction);
  assert.match(direction.content, /可沿用|避免|不是 Instagram/);
  const framed = formatContextForInstructions(packed);
  assert.match(framed, /creative_direction/);
  assert.doesNotMatch(framed, /已搜尋整個 Instagram/);
});
