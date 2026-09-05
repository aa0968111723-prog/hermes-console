import test from "node:test";
import assert from "node:assert/strict";
import {
  groupedTamkangCapabilities,
  mapTamkangTools,
  tamkangConfigured,
} from "../lib/server/tamkang.ts";
import { queryTkuCalendar } from "../lib/server/mcp/tamkang-adapter.ts";
import { interpretVerification, projectMcpIsolated } from "../lib/server/mcp-registry.ts";
import { routeToolsets } from "../lib/server/projects/router.ts";
import { officialWebSources } from "../lib/server/research/providers.ts";

test("Phase 3 verified MCP routing and Tamkang fallback", async (t) => {
  await t.test("HTTP 200 is not Verified; initialize+list+safeRead is", () => {
    assert.equal(
      interpretVerification({ initialize: true, toolsList: false, safeRead: false }),
      "connected",
    );
    assert.equal(
      interpretVerification({ initialize: true, toolsList: true, safeRead: false }),
      "partial",
    );
    assert.equal(
      interpretVerification({ initialize: true, toolsList: true, safeRead: true }),
      "verified",
    );
  });

  await t.test("Tamkang mapping uses description and schema, not only tool name", () => {
    const mapping = mapTamkangTools([
      {
        name: "alpha",
        description: "Official campus calendar for freshman week",
        inputSchema: { type: "object", properties: { week: { type: "number" } } },
      },
      {
        name: "beta",
        description: "Student club directory",
        inputSchema: { properties: { society: { type: "string" } } },
      },
    ]);
    assert.equal(mapping.tku_calendar, "alpha");
    assert.equal(mapping.tku_clubs, "beta");
    const grouped = groupedTamkangCapabilities(mapping);
    assert.equal(grouped.calendar, "alpha");
    assert.equal(grouped.clubs, "beta");
    assert.equal(grouped.news, null);
  });

  await t.test("unconfigured Tamkang uses console notes plus official web sources", async () => {
    assert.equal(tamkangConfigured(), Boolean(process.env.TKU_MCP_URL && process.env.TKU_MCP_TOKEN));
    const calendar = await queryTkuCalendar(2);
    assert.equal((calendar as { source?: string }).source, "console_notes");
    assert.equal((calendar as { mcpVerified?: boolean }).mcpVerified, false);
    const sources = officialWebSources();
    assert.ok(sources.some((item) => item.official && item.url.includes("tku.edu.tw")));
  });

  await t.test("project MCP mappings do not leak across projects", () => {
    const planform = routeToolsets("幫我排攤位 3D", "planform");
    const cutos = routeToolsets("幫我剪輯迎新影片", "cutos");
    assert.ok(planform.mappings.every((item) => !item.projectId || item.projectId === "planform"));
    assert.ok(cutos.mappings.every((item) => !item.projectId || item.projectId === "cutos"));
    assert.equal(projectMcpIsolated("planform", "cutos"), true);
  });
});
