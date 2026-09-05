import test from "node:test";
import assert from "node:assert/strict";
import {
  reverseThinkingTriggers,
  wantsReverseThinking,
} from "../lib/server/audience.ts";
import {
  REVERSE_ORDER,
  runReverseThinkingEvaluation,
} from "../lib/server/audience-twin/reverse-thinking.ts";
import { AUDIENCE_DISCLAIMER } from "../lib/server/audience.ts";
import { runCreativeIntelligence } from "../lib/server/creative/pipeline.ts";

test("Phase 6 reverse thinking and simulated evaluation", async (t) => {
  await t.test("detects reverse-thinking prompts without claiming live research", () => {
    assert.equal(wantsReverseThinking("路人會不會滑掉"), true);
    assert.equal(wantsReverseThinking("站在新生角度反向看。"), true);
    assert.equal(wantsReverseThinking("倒過來想如果我是懷疑者"), true);
    assert.equal(wantsReverseThinking("幫我做禪學社茶會網宣"), false);
    assert.ok(reverseThinkingTriggers("路人會不會滑掉").includes("swipe_risk"));
  });

  await t.test("reverse pass starts with bystander and is heuristic-only", () => {
    const result = runReverseThinkingEvaluation({
      prompt: "路人會不會滑掉？站在受眾角度反向看",
      conceptTitle: "改變自己，從靜定開始",
      description: "改變自己，從靜定開始。",
      copyExcerpt: "改變自己，從靜定開始。",
      projectId: "tku-zen-agent",
    });
    assert.equal(result.triggered, true);
    assert.equal(result.simulation, true);
    assert.equal(result.method, "ai_heuristic");
    assert.equal(result.personaSource, "console_fixture");
    assert.equal(result.disclaimer, AUDIENCE_DISCLAIMER);
    assert.deepEqual(result.order, REVERSE_ORDER);
    assert.equal(result.perspectives[0].personaId, "bystander");
    assert.ok(result.perspectives[0].prompt.includes("滑掉"));
    assert.equal(result.swipeRisk.method, "ai_heuristic");
    assert.equal("conversionRate" in result.swipeRisk, false);
    assert.ok(!JSON.stringify(result.swipeRisk).includes("conversionRate"));
    assert.equal(result.envelope.simulation, true);
    assert.equal(result.envelope.method, "ai_heuristic");
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        result.envelope.roles[0].scores.scores,
        "conversionRate",
      ),
      false,
    );
    assert.ok(result.simulatedEvaluation.feedback.length === 5);
    assert.ok(result.recommendedRevisions.length >= 1);
  });

  await t.test("NTU reverse thinking does not leak Tamkang landmarks", () => {
    const result = runReverseThinkingEvaluation({
      prompt: "如果我是台大新生會不會滑掉",
      conceptTitle: "台大椰林大道迎新野餐",
      description: "椰林迷路與通識避雷，免費冷泡茶。",
      projectId: "ntu",
    });
    const blob = JSON.stringify(result.perspectives) + JSON.stringify(result.simulatedEvaluation.facts);
    assert.ok(!blob.includes("克難坡"));
    assert.ok(!blob.includes("福園"));
    assert.equal(result.simulatedEvaluation.domain, "ntu");
    assert.ok(result.perspectives[2].name.includes("宇軒"));
  });

  await t.test("creative pipeline attaches reverse thinking only when prompted", () => {
    const plain = runCreativeIntelligence({
      prompt: "幫我做一個給淡江大一新生看的禪學社迎新茶會網宣",
    });
    assert.equal(plain.reverseThinking, null);
    const reverse = runCreativeIntelligence({
      prompt: "幫我做給淡江大一新生的茶會網宣，路人會不會滑掉？",
    });
    assert.ok(reverse.reverseThinking);
    assert.equal(reverse.reverseThinking?.method, "ai_heuristic");
    assert.equal(reverse.reverseThinking?.perspectives[0].sourceKind, "console_fixture");
  });
});
