import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDirectionChatPrompt,
  EXTENSION_SHORTCUTS,
  type ExtensionTopic,
} from "../lib/client/chat-bridge.ts";
import type { CreativeDirection } from "../lib/server/creative-workflow/pipeline.ts";

const mockDirection: CreativeDirection = {
  id: "dir_test_oasis",
  title: "通識搶課轉圈圈・一席清幽心靈綠洲",
  subtitle: "初入校園・給自己一個按下 Pause 的午後",
  hook: "選課系統轉圈圈心好累？來活大體驗 5 分鐘關掉雜訊的深層呼吸禪。",
  coreInsight: "開學初期搶課焦慮與適應壓力，主打無推銷與學長姐選課避雷指南。",
  visualConcept: "日系簡約風格。冷杉灰綠與霧白底色，角落 36px 手作三色光印章。",
  colorPalette: [
    { name: "冷杉清灰綠", hex: "#4A6357" },
    { name: "極簡月光白", hex: "#FAFAF8" },
    { name: "琥珀茶湯金", hex: "#D4A359" },
    { name: "墨色沉澱黑", hex: "#232B28" },
  ],
  audienceScores: {
    overallScore: 91,
    stopIntent: 89,
    relevance: 94,
    peerAffinity: 88,
    ctaClarity: 92,
    safetyIndex: 95,
  },
  audienceFeedback: {
    conceptTitle: "通識搶課轉圈圈・一席清幽心靈綠洲",
    scores: {
      overallScore: 91,
      stopIntent: 89,
      relevance: 94,
      peerAffinity: 88,
      ctaClarity: 92,
      safetyIndex: 95,
    },
    consensus: "strongly_recommended",
    debateSummary: "受眾一致認為生活痛點明確。",
    feedback: [],
    evidencePoints: [],
    hypothesisPoints: [],
    disclaimer: "AI Heuristic Disclaimer",
    simulation: true,
    method: "ai_heuristic",
    personaSource: "console_fixture",
    domain: "ntu",
  },
  canvaBlueprint: {
    title: "通識搶課轉圈圈",
    dimensions: "1080x1350",
    exportDraftUrl: "https://www.canva.com/design/mock",
    layers: [],
  },
  igCaption: {
    hook: "選課心好累？",
    body: "來喝好茶。",
    eventLogistics: "每週二 18:30",
    callToAction: "點擊連結",
    hashtags: ["#臺大", "#心靈綠洲"],
  },
};

test("Phase 12 Chat & Creative Intelligence Bridge", async (t) => {
  await t.test("EXTENSION_SHORTCUTS defines 4 coherent extension themes", () => {
    assert.equal(EXTENSION_SHORTCUTS.length, 4);
    const topics = EXTENSION_SHORTCUTS.map((s) => s.topic);
    assert.deepEqual(topics, [
      "host_script",
      "interactive_cards",
      "story_script",
      "custom_chat",
    ]);
  });

  await t.test("buildDirectionChatPrompt generates host_script with hook and visual concept", () => {
    const prompt = buildDirectionChatPrompt({
      direction: mockDirection,
      domain: "ntu",
      topic: "host_script",
    });

    assert.ok(prompt.includes("【臺灣大學】"));
    assert.ok(prompt.includes("通識搶課轉圈圈・一席清幽心靈綠洲"));
    assert.ok(prompt.includes("dir_test_oasis"));
    assert.ok(prompt.includes("活動當天 3 分鐘破冰主持講稿"));
    assert.ok(prompt.includes(mockDirection.hook));
    assert.ok(prompt.includes(mockDirection.visualConcept));
  });

  await t.test("buildDirectionChatPrompt generates interactive_cards embedding palette names", () => {
    const prompt = buildDirectionChatPrompt({
      direction: mockDirection,
      domain: "tamkang",
      topic: "interactive_cards",
    });

    assert.ok(prompt.includes("【淡江大學】"));
    assert.ok(prompt.includes("迎新茶會現場 5 張破冰互動問答卡"));
    assert.ok(prompt.includes("冷杉清灰綠、極簡月光白、琥珀茶湯金、墨色沉澱黑"));
  });

  await t.test("buildDirectionChatPrompt generates story_script with 9:16 layout requirements", () => {
    const prompt = buildDirectionChatPrompt({
      direction: mockDirection,
      domain: "general",
      topic: "story_script",
    });

    assert.ok(prompt.includes("【大專院校】"));
    assert.ok(prompt.includes("Instagram 限時動態 (Story) 3 篇連續發布腳本"));
    assert.ok(prompt.includes("9:16"));
    assert.ok(prompt.includes("倒數前兩天"));
    assert.ok(prompt.includes("倒數前一天"));
    assert.ok(prompt.includes("活動當天"));
  });

  await t.test("buildDirectionChatPrompt handles custom_chat prompt correctly", () => {
    const customPrompt = "請幫我把這張海報的主標改得更具幽默感一點";
    const prompt = buildDirectionChatPrompt({
      direction: mockDirection,
      domain: "ntu",
      topic: "custom_chat",
      customPrompt,
    });

    assert.ok(prompt.includes("【臺灣大學】"));
    assert.ok(prompt.includes(customPrompt));
  });
});
