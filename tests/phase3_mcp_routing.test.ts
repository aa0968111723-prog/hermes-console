import test from "node:test";
import assert from "node:assert/strict";
import {
  groupedTamkangCapabilities,
  mapTamkangTools,
  resolveTamkangTool,
  getTamkangCapabilityCoverage,
  tamkangStatus,
  tamkangConfigured,
  TAMKANG_CAPABILITIES,
} from "../lib/server/tamkang.ts";
import {
  queryTkuCalendar,
  queryTkuVenues,
  getTkuZenClubProfile,
  getTkuSourceProvenance,
} from "../lib/server/mcp/tamkang-adapter.ts";
import {
  interpretVerification,
  projectMcpIsolated,
  seedRegistry,
} from "../lib/server/mcp-registry.ts";
import {
  routeToolsets,
  getDynamicProjectCatalog,
} from "../lib/server/projects/router.ts";
import { officialWebSources } from "../lib/server/research/providers.ts";

test("Phase 3 verified MCP routing, Tamkang fallback, and project isolation", async (t) => {
  await t.test("HTTP 200 is not Verified; initialize+list+safeRead is", () => {
    assert.equal(
      interpretVerification({ initialize: false, toolsList: false, safeRead: false }),
      "failed",
    );
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

  await t.test("Tamkang capability mapping, resolver and coverage analysis", () => {
    const mockTools = [
      { name: "search_campus" },
      { name: "get_tku_calendar" },
      { name: "get_tku_venues" },
      { name: "get_tku_news" },
      { name: "find_zen_club" },
    ];

    const mapping = mapTamkangTools(mockTools);
    assert.equal(mapping.tku_calendar, "get_tku_calendar");
    assert.equal(mapping.tku_facilities, "get_tku_venues");
    assert.equal(mapping.tku_news, "get_tku_news");
    assert.equal(mapping.tku_clubs, "find_zen_club");
    assert.equal(mapping.tku_search, "search_campus");
    assert.equal(mapping.tku_courses, null);

    // resolveTamkangTool 專用查詢
    assert.equal(resolveTamkangTool("tku_calendar", mockTools), "get_tku_calendar");
    assert.equal(resolveTamkangTool("tku_facilities", mockTools), "get_tku_venues");
    assert.equal(resolveTamkangTool("tku_courses", mockTools), null);

    // Coverage 分析
    const coverage = getTamkangCapabilityCoverage(mockTools);
    assert.equal(coverage.totalCount, TAMKANG_CAPABILITIES.length);
    assert.ok(coverage.mappedCount >= 5);
    assert.ok(coverage.coveragePercent > 0 && coverage.coveragePercent <= 100);
    assert.ok(coverage.missingCapabilities.includes("tku_courses"));
    assert.ok(!coverage.missingCapabilities.includes("tku_calendar"));
  });

  await t.test("unconfigured Tamkang uses console notes plus official web sources", async () => {
    assert.equal(tamkangConfigured(), Boolean(process.env.TKU_MCP_URL && process.env.TKU_MCP_TOKEN));
    const calendar = await queryTkuCalendar(2);
    assert.equal((calendar as { source?: string }).source, "console_notes");
    assert.equal((calendar as { mcpVerified?: boolean }).mcpVerified, false);
    const sources = officialWebSources();
    assert.ok(sources.some((item) => item.official && item.url.includes("tku.edu.tw")));
  });

  await t.test("Tamkang local notes are explicitly labeled and not claimed as remote MCP", async () => {
    const previousUrl = process.env.TKU_MCP_URL;
    delete process.env.TKU_MCP_URL;

    try {
      // 1. Calendar
      const cal = await queryTkuCalendar(2);
      assert.ok(cal, "應能取得行事曆");
      assert.equal((cal as any).sourceLayer, "console_local_notes");
      assert.equal((cal as any).isRemoteMcp, false);
      assert.equal((cal as any).source, "console_notes");
      assert.equal((cal as any).mcpVerified, false);

      const calProv = getTkuSourceProvenance(cal);
      assert.equal(calProv.isRemoteMcp, false);
      assert.equal(calProv.sourceLayer, "console_local_notes");

      // 2. Venues
      const venues = await queryTkuVenues("gongdeng_lawn");
      assert.ok(venues, "應能取得場地資料");
      assert.equal((venues as any).sourceLayer, "console_local_notes");
      assert.equal((venues as any).isRemoteMcp, false);
      assert.equal((venues as any).source, "console_notes");
      assert.equal((venues as any).mcpVerified, false);

      const venueProv = getTkuSourceProvenance(venues);
      assert.equal(venueProv.isRemoteMcp, false);
      assert.equal(venueProv.sourceLayer, "console_local_notes");

      // 3. Zen Club Profile
      const club = getTkuZenClubProfile();
      assert.equal(club.sourceLayer, "console_local_notes");
      assert.equal(club.isRemoteMcp, false);
      assert.equal(club.source, "console_notes");
      assert.equal(club.mcpVerified, false);

      const clubProv = getTkuSourceProvenance(club);
      assert.equal(clubProv.isRemoteMcp, false);
      assert.equal(clubProv.sourceLayer, "console_local_notes");
    } finally {
      if (previousUrl !== undefined) process.env.TKU_MCP_URL = previousUrl;
    }
  });

  await t.test("Tamkang truthful status contracts", () => {
    const unconfigured = tamkangStatus();
    assert.equal(unconfigured.state, "unconfigured");
    assert.equal(unconfigured.fallback, "web_research");

    const failed = tamkangStatus({ reachable: false });
    assert.ok(["failed", "unconfigured"].includes(failed.state));
    assert.equal(failed.fallback, "web_research");

    const verified = tamkangStatus({
      reachable: true,
      verifiedRead: true,
      tools: [{ name: "query_calendar" }],
    });
    if (tamkangConfigured()) {
      assert.equal(verified.state, "available");
      assert.equal(verified.fallback, null);
    } else {
      assert.equal(verified.state, "unconfigured");
    }
  });

  await t.test("project MCP mappings do not leak across projects", () => {
    const planform = routeToolsets("幫我排攤位 3D", "planform");
    const cutos = routeToolsets("幫我剪輯迎新影片", "cutos");
    assert.ok(planform.mappings.every((item) => !item.projectId || item.projectId === "planform"));
    assert.ok(cutos.mappings.every((item) => !item.projectId || item.projectId === "cutos"));
    assert.equal(projectMcpIsolated("planform", "cutos"), true);
  });

  await t.test("Project tool routing and dynamic catalog evaluation", () => {
    // 1. 意圖導向工具集選擇
    const booth = routeToolsets("幫我做迎新茶會的攤位空間");
    assert.ok(booth.toolsets.includes("planform"));
    assert.ok(booth.toolsets.includes("tamkang"));
    assert.ok(!booth.toolsets.includes("cutos"));
    assert.equal(booth.intentClassification, "space_and_booth");

    const video = routeToolsets("幫我做迎新回顧宣傳影片");
    assert.ok(video.toolsets.includes("cutos"));
    assert.ok(!video.toolsets.includes("planform"));
    assert.equal(video.intentClassification, "video_production");

    const poster = routeToolsets("淡江大學大一新生禪學社迎新茶會宣傳海報");
    assert.ok(poster.toolsets.includes("tamkang"));
    assert.ok(poster.toolsets.includes("canva"));
    assert.ok(poster.toolsets.includes("inspiration"));
    assert.ok(poster.toolsets.includes("audience"));
    assert.equal(poster.intentClassification, "creative_campaign");

    // 2. 動態目錄狀態評估
    const catalog = getDynamicProjectCatalog();
    assert.ok(catalog.length >= 5);
    const planformItem = catalog.find((i) => i.mcpServerId === "planform");
    const tkuItem = catalog.find((i) => i.mcpServerId === "tamkang");
    const canvaItem = catalog.find((i) => i.mcpServerId === "canva");

    assert.ok(planformItem);
    assert.ok(tkuItem);
    assert.ok(canvaItem);

    if (!process.env.PLANFORM_MCP_URL) {
      assert.equal(planformItem?.enabled, false);
      assert.equal(planformItem?.status, "disabled");
    }
    if (!process.env.TKU_MCP_URL) {
      assert.equal(tkuItem?.enabled, false);
      assert.equal(tkuItem?.status, "fallback_available");
    }
    assert.equal(canvaItem?.enabled, true);
    assert.equal(canvaItem?.status, "ready");
  });

  await t.test("MCP registry seed provides required workspace and tku baselines", () => {
    const seeded = seedRegistry();
    assert.ok(seeded.some((e) => e.id === "workspace"));
    assert.ok(seeded.some((e) => e.id === "tku"));
  });
});
