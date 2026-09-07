import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-research-"));
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";

const { executeResearchBundle } = await import("../lib/server/research/executor");
const { researchBundle } = await import("../lib/server/research/providers");

test("research executor only marks executed when a page is actually retrieved", async (t) => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<html><title>淡江大學</title><body>官方首頁內容供測試抓取。</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = (server.address() as { port: number }).port;
  const url = "http://127.0.0.1:" + port + "/";

  await t.test("plan-only bundle stays unexecuted", async () => {
    const plan = researchBundle({ prompt: "幫我寫一首詩" });
    const executed = await executeResearchBundle(plan);
    assert.equal(plan.executed, false);
    assert.equal(executed.executed, false);
    assert.equal(executed.sources.length, 0);
  });

  await t.test("fetched official page becomes source-verified evidence", async () => {
    const plan = researchBundle({ prompt: "淡江新生" });
    plan.sourceDirectory = [
      {
        id: "local-official",
        url,
        provider: "source_directory",
        title: "待查",
        excerpt: "",
        retrievedAt: null,
        publishedAt: null,
        official: true,
        confidence: null,
        usedFor: "research_entry",
        verification: "not_fetched",
      },
    ];
    const executed = await executeResearchBundle(plan);
    assert.equal(executed.executed, true);
    assert.equal(executed.sources[0].verification, "fetched");
    assert.ok(executed.sources[0].retrievedAt);
    assert.match(executed.sources[0].excerpt, /官方首頁/);
    assert.equal(executed.claims[0].truth, "SOURCE_VERIFIED");
    assert.ok(!/85%/.test(JSON.stringify(executed)));
  });

  await t.test("failed fetch does not invent claims", async () => {
    const plan = researchBundle({ prompt: "淡江新生" });
    plan.sourceDirectory = [
      {
        id: "down",
        url: "http://127.0.0.1:9/",
        provider: "source_directory",
        title: "待查",
        excerpt: "",
        retrievedAt: null,
        publishedAt: null,
        official: true,
        confidence: null,
        usedFor: "research_entry",
        verification: "not_fetched",
      },
    ];
    const executed = await executeResearchBundle(plan);
    assert.equal(executed.executed, false);
    assert.equal(executed.claims.length, 0);
    assert.equal(executed.sources[0].verification, "failed");
  });
});
