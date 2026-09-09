import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-visual-language-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3220";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";

const { tkuVisualLanguage, matchCaptionPatterns, visualLanguageHandoff } =
  await import("../lib/server/inspiration/visual-language");
const { analyzeReference, resolveInspirationUrl } =
  await import("../lib/server/inspiration/engine");
const { ingestUrl } = await import("../lib/server/inspiration");
const inspirationRoute = await import("../app/api/inspiration/route");
const { seedSession } = await import("./session-fixture");

test("tku visual language is provenance-labelled and not a fake IG connection", () => {
  const brief = tkuVisualLanguage();
  assert.equal(brief.account, "tku_zc");
  assert.equal(brief.instagramConnected, false);
  assert.equal(brief.fullGridUnknown, true);
  assert.equal(brief.storiesUnknown, true);
  assert.equal(brief.reelsMotionUnknown, true);
  assert.equal(brief.imageReadCount, 5);
  assert.ok(brief.keep.length >= 3 && brief.keep.length <= 10);
  assert.equal(brief.avoid.length, 3);
  assert.ok(brief.biggestProblem.includes("畫風") || brief.biggestProblem.includes("認不出"));
  assert.equal(brief.visualAgent.dont.includes("3D／寫實 AI 人物。"), true);
  assert.ok(brief.copywritingAgent.dont.some((item) => item.includes("菩薩")));
  for (const pattern of [...brief.keep, ...brief.avoid]) {
    assert.ok(["design", "layout", "hook", "cta", "audience"].includes(pattern.kind));
    assert.ok(pattern.evidence.length > 0);
    assert.ok(
      pattern.evidence.every((item) =>
        ["FACT", "EVIDENCE", "INFERENCE", "INSPIRATION", "UNKNOWN"].includes(
          item.provenance,
        ),
      ),
    );
    assert.ok(pattern.visualAgentInput);
    assert.ok(pattern.copywritingAgentInput);
  }
  const handoff = visualLanguageHandoff();
  assert.ok(handoff.includes("instagramConnected=false"));
  assert.ok(!handoff.toLowerCase().includes("chain-of-thought"));
  assert.equal(brief.nextSlot.id, "fair-story-2026-09-10");
  assert.equal(brief.nextSlot.format, "9:16");
  assert.equal(brief.nextSlot.location.provenance, "FACT");
  assert.equal(brief.nextSlot.location.value, "文館左側");
  assert.ok(handoff.includes("9:16 社博限動"));
  const tea = brief.slots.find((slot) => slot.id === "tea-feed-2026-09-06");
  assert.equal(tea?.location.provenance, "UNKNOWN");
  assert.equal(brief.live.feed.stale, true);
  assert.equal(brief.live.story.seen, false);
  assert.equal(brief.live.story.provenance, "UNKNOWN");
  assert.equal(brief.live.instagramConnected, false);
  const onPostingDay = tkuVisualLanguage("2026-09-08");
  assert.equal(onPostingDay.live.feed.stale, false);
  assert.equal(brief.nextSlot.beats?.length, 3);
  assert.ok(
    brief.nextSlot.beats?.every((beat) => [...beat.onImage].length <= beat.maxChars),
  );
  assert.equal(brief.nextSlot.beats?.[1].onImage, "文館左側");
});

test("caption rules match keep patterns without claiming image read", () => {
  assert.deepEqual(matchCaptionPatterns(""), []);
  assert.ok(matchCaptionPatterns("來玩專注力遊戲就有機會拿手搖飲").includes("先給好處再開社團"));
  assert.ok(matchCaptionPatterns("來淡江，先學會跟淡水天氣相處").includes("淡水生存指南"));
  const analysis = analyzeReference({
    caption: "新鮮人來社博攤位晃晃，文館左側有手搖飲",
    platform: "instagram",
    sourceUrl: "https://www.instagram.com/tku_zc/p/DdDVyBMk0Xb/",
  });
  assert.equal(analysis.imageRead, false);
  assert.equal(analysis.visualAnalysis, null);
  assert.equal(analysis.executable, false);
  assert.equal(analysis.method, "caption_rules");
  assert.ok(analysis.matchedPatterns.includes("先給好處再開社團"));
  assert.ok(analysis.matchedPatterns.includes("低壓到場：來晃晃就好"));
  assert.match(analysis.ctaAnalysis, /低壓/);
  assert.match(analysis.whyRelevant, /尚未讀取圖片/);
});

test("ingest without caption still has empty borrow; caption can fill patterns", () => {
  const plain = ingestUrl({
    url: "https://www.instagram.com/p/LanguagePlain/",
    projectId: "personal",
  });
  assert.deepEqual(plain.borrow, []);
  const withCaption = resolveInspirationUrl({
    url: "https://www.instagram.com/tku_zc/p/DdDVyBMk0Xb/",
    projectId: "personal",
    caption: "來禪學社的攤位玩專注力遊戲，把手搖飲帶回家",
  });
  assert.ok(withCaption.borrow.includes("先給好處再開社團"));
  assert.match(withCaption.fit, /尚未讀取圖片/);
});

test("inspiration GET returns visual language without claiming Instagram search", async () => {
  const response = await inspirationRoute.GET(
    new Request("http://localhost:3220/api/inspiration", {
      headers: { Cookie: seedSession().cookie },
    }),
  );
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.instagram.fullSiteSearch, false);
  assert.equal(json.instagram.authorizedApi, false);
  assert.equal(json.visualLanguage.instagramConnected, false);
  assert.equal(json.visualLanguage.keep.length, tkuVisualLanguage().keep.length);
  assert.equal(json.visualLanguage.avoid.length, 3);
});
