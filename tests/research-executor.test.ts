import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-research-"));
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";

const { executeResearchBundle } = await import("../lib/server/research/executor");
const {
  formatResearchPlanForInstructions,
  researchBundle,
} = await import("../lib/server/research/providers");

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

  await t.test(
    "instructions use post-execute bundle sources and claims, not the plan snapshot",
    async () => {
      const plan = researchBundle({ prompt: "教心所研究倫理與學習動機文獻" });
      plan.sourceDirectory = [
        {
          id: "local-edpsy",
          url,
          provider: "source_directory",
          title: "待查教心所入口",
          excerpt: "",
          retrievedAt: null,
          publishedAt: null,
          official: true,
          confidence: null,
          usedFor: "research_entry",
          verification: "not_fetched",
        },
      ];
      const snapshot = formatResearchPlanForInstructions(plan);
      assert.match(snapshot, /executed=false/);
      assert.match(snapshot, /尚未取得外部 evidence/);
      assert.equal(snapshot.includes("官方首頁"), false);
      assert.equal(snapshot.includes("SOURCE_VERIFIED"), false);

      const executed = await executeResearchBundle(plan);
      const instructions = formatResearchPlanForInstructions(executed);
      assert.equal(executed.executed, true);
      assert.match(instructions, /executed=true/);
      assert.match(instructions, /已抓取來源/);
      assert.match(instructions, /官方首頁/);
      assert.match(instructions, /SOURCE_VERIFIED/);
      assert.match(instructions, /不是民調或完整文獻檢索|不是已完成的文獻檢索/);
      assert.equal(/自行撰寫|補齊文獻|虛構論文/.test(instructions), false);
      assert.notEqual(instructions, snapshot);
    },
  );
});

test("Tamkang Miraheze wiki is an official research source", async (t) => {
  const previous = process.env.HERMES_ALLOW_LOOPBACK_HTTP;
  t.after(() => {
    process.env.HERMES_ALLOW_LOOPBACK_HTTP = previous;
  });
  process.env.HERMES_ALLOW_LOOPBACK_HTTP = "false";

  const wikiUrl = "https://tku.miraheze.org/wiki/zh-Hant/%E9%A6%96%E9%A0%81";

  function directoryStub(id: string, url: string) {
    return {
      id,
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
    };
  }

  await t.test("freshman and eduPsych directories include tku-miraheze", () => {
    const freshman = researchBundle({ prompt: "淡江新生" });
    const wiki = freshman.sourceDirectory.find((item) => item.id === "tku-miraheze");
    assert.ok(wiki);
    assert.equal(wiki.url, wikiUrl);
    assert.equal(wiki.title, "淡江 wiki（Miraheze）");
    assert.equal(wiki.usedFor, "research_entry");
    assert.equal(wiki.verification, "not_fetched");

    const eduPsych = researchBundle({
      prompt: "教心所研究倫理與學習動機文獻",
    });
    assert.ok(
      eduPsych.sourceDirectory.some((item) => item.id === "tku-miraheze"),
    );
  });

  await t.test("allowed Miraheze host can fetch via mock", async () => {
    const plan = researchBundle({ prompt: "淡江新生" });
    plan.sourceDirectory = [directoryStub("tku-miraheze", wikiUrl)];
    let fetchedUrl = "";
    const executed = await executeResearchBundle(plan, async (url) => {
      fetchedUrl = String(url);
      return new Response(
        "<html><title>淡江 wiki（Miraheze）</title><body>淡江 wiki 首頁內容供測試抓取。</body></html>",
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    });
    assert.equal(new URL(fetchedUrl).hostname, "tku.miraheze.org");
    assert.equal(executed.executed, true);
    assert.equal(executed.sources[0].verification, "fetched");
    assert.match(executed.sources[0].excerpt, /淡江 wiki/);
  });

  await t.test("disallowed host stays not_fetched", async () => {
    const plan = researchBundle({ prompt: "淡江新生" });
    plan.sourceDirectory = [
      directoryStub("blocked", "https://evil.example.com/wiki"),
    ];
    const executed = await executeResearchBundle(plan, async () => {
      throw new Error("disallowed host must not be fetched");
    });
    assert.equal(executed.executed, false);
    assert.equal(executed.sources[0].verification, "not_fetched");
    assert.equal(executed.claims.length, 0);
  });
});
