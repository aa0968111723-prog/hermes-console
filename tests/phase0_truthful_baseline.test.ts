import test from "node:test";
import assert from "node:assert/strict";
import {
  getAllIntegrationsReport,
  probeCanvaStatus,
  probeInstagramStatus,
  probePinterestStatus,
  probeTamkangMcpStatus,
} from "../lib/server/integrations/truth-status.ts";
import { getMcpServers } from "../lib/server/mcp/registry.ts";
import { seedRegistry } from "../lib/server/mcp-registry.ts";
import { listAgentProfiles } from "../lib/server/hermes/registry.ts";
import { searchMemories } from "../lib/server/hermes/memory.ts";
import { researchInstagramTrends } from "../lib/server/social/instagram-research.ts";

const VALID_STATUSES = [
  "Connected",
  "Verified",
  "Partial",
  "Unconfigured",
  "Needs Authorization",
  "Unsupported",
  "Failed",
];

test("Phase 0 truthful integration baseline", async (t) => {
  await t.test("Tamkang without TKU_MCP_URL is Unconfigured, not Connected/Verified", async () => {
    const previous = process.env.TKU_MCP_URL;
    delete process.env.TKU_MCP_URL;
    try {
      const status = await probeTamkangMcpStatus();
      assert.equal(status.status, "Unconfigured");
      assert.ok(!/Connected|Verified/.test(status.status));
      assert.ok(status.details.includes("不是 MCP"));
    } finally {
      if (previous !== undefined) process.env.TKU_MCP_URL = previous;
    }
  });

  await t.test("Instagram and Pinterest env-only probes are not Connected", () => {
    const ig = probeInstagramStatus();
    const pin = probePinterestStatus();
    assert.notEqual(ig.status, "Connected");
    assert.notEqual(ig.status, "Verified");
    assert.notEqual(pin.status, "Connected");
    assert.notEqual(pin.status, "Verified");
    assert.ok(VALID_STATUSES.includes(ig.status));
    assert.ok(VALID_STATUSES.includes(pin.status));
  });

  await t.test("Instagram research does not claim Graph API or Connected", () => {
    const report = researchInstagramTrends({ domain: "tamkang", topic: "茶會" });
    assert.equal(report.dataSource, "campus_trend_engine");
    assert.equal(report.truthStatus.connected, false);
    assert.notEqual(report.truthStatus.status, "Connected");
  });

  await t.test("Canva without vault verify is not Connected", () => {
    const canva = probeCanvaStatus();
    assert.notEqual(canva.status, "Connected");
    assert.ok(VALID_STATUSES.includes(canva.status));
  });

  await t.test("MCP catalog does not mark GitHub or unconfigured Tamkang as connected", () => {
    const previous = process.env.TKU_MCP_URL;
    delete process.env.TKU_MCP_URL;
    try {
      const servers = getMcpServers();
      const tku = servers.find((item) => item.id === "tku-campus-mcp");
      const eco = servers.find((item) => item.id === "hermes-ecosystem-mcp");
      assert.equal(tku?.status, "unconfigured");
      assert.equal(eco?.status, "unconfigured");
      assert.ok(eco?.description.includes("不是 MCP"));
    } finally {
      if (previous !== undefined) process.env.TKU_MCP_URL = previous;
    }
  });

  await t.test("seeded Tamkang MCP without URL is unconfigured", () => {
    const tku = seedRegistry().find((item) => item.id === "tku");
    if (!process.env.TKU_MCP_URL) {
      assert.equal(tku?.status, "unconfigured");
    } else {
      assert.notEqual(tku?.status, "connected");
      assert.notEqual(tku?.status, "verified");
    }
  });

  await t.test("Console agent profiles are console_role, not live Hermes /p/<profile>", () => {
    const profiles = listAgentProfiles();
    assert.ok(profiles.length >= 7);
    for (const profile of profiles) {
      assert.equal(profile.kind, "console_role");
      assert.equal(profile.hermesProfilePath, null);
    }
  });

  await t.test("Console seed memories are labeled as console_seed, not Hermes memory", () => {
    const memories = searchMemories("克難坡", "tku-zen-agent");
    assert.ok(memories.length > 0);
    assert.ok(memories.every((item) => item.sourceLayer === "console_seed"));
    assert.ok(!memories.some((item) => item.evidenceType === "verified_fact"));
  });

  await t.test("overall integration report never uses illegal statuses", async () => {
    const report = await getAllIntegrationsReport();
    assert.equal(report.integrations.length, 5);
    for (const item of report.integrations) {
      assert.ok(VALID_STATUSES.includes(item.status), item.id + " " + item.status);
    }
    const tku = report.integrations.find((item) => item.id === "tku_mcp");
    if (!process.env.TKU_MCP_URL) {
      assert.equal(tku?.status, "Unconfigured");
    }
  });
});
