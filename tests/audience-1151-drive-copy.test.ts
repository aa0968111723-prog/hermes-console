import test from "node:test";
import assert from "node:assert/strict";

const { simulateFreshmanReactions, extractSignals } = await import(
  "../lib/server/audience/personas"
);

// FACT from 禪學社 Google Drive「期初宣傳區」
// https://docs.google.com/document/d/1XjaU_aCX4cVX3bO9JhSRUt2MElK1Qmr4pLhn4CoRCQw
const DRIVE_SOURCE =
  "https://docs.google.com/document/d/1XjaU_aCX4cVX3bO9JhSRUt2MElK1Qmr4pLhn4CoRCQw";

const TEA_COPY = `🍵禪學社期初茶會【改變自己從靜定開始】🧘
日期：2026/9/30（三）
時間：19:00~21:30（18:50 開放報到）
地點：待定
報名表單：https://forms.gle/Xs4PXyWKQW5ob29z6`;

const BOOTH_COPY = `來到淡大的新鮮人
還在煩惱不知道要加入哪個社團嗎？
來禪學社的攤位玩專注力遊戲
不只可以認識我們，還有機會把手搖飲帶回家！
📍 擺攤資訊
日期：9/10（四）、9/11（五）、9/14（一）～9/17（四）
地點：文館左側`;

test("115-1 tea copy from Drive keeps location UNKNOWN and flags 靜定 pressure", () => {
  const signals = extractSignals({
    kind: "event",
    title: "改變自己從靜定開始",
    copy: TEA_COPY,
  });
  assert.equal(signals.unknownPlace, true);
  assert.equal(signals.jargon, true);
  const panel = simulateFreshmanReactions({
    kind: "event",
    title: "改變自己從靜定開始",
    copy: TEA_COPY,
  });
  assert.ok(panel.unknowns.some((item) => item.includes("地點尚未確認")));
  const commute = panel.personas.find((item) => item.personaId === "commute")!;
  assert.ok(commute.firstReaction.includes("待定") || commute.unknowns.includes("地點尚未確認"));
  const wary = panel.personas.find((item) => item.personaId === "religion_wary")!;
  assert.ok(wary.scores.scores.religiousPressure > 40);
  assert.equal(panel.disclaimer.includes("市場調查"), true);
  assert.equal(DRIVE_SOURCE.startsWith("https://docs.google.com/"), true);
});

test("115-1 booth copy with 手搖飲 and 文館 stops the uninterested twin more than 靜定 slogan", () => {
  const slogan = simulateFreshmanReactions({
    kind: "poster",
    title: "改變自己從靜定開始",
    copy: "改變自己，從靜定開始。",
  });
  const booth = simulateFreshmanReactions({
    kind: "booth",
    title: "社博攤位",
    copy: BOOTH_COPY,
  });
  const boredSlogan = slogan.personas.find((item) => item.personaId === "uninterested")!;
  const boredBooth = booth.personas.find((item) => item.personaId === "uninterested")!;
  assert.ok(extractSignals({ kind: "booth", copy: BOOTH_COPY }).food);
  assert.ok(extractSignals({ kind: "booth", copy: BOOTH_COPY }).local);
  assert.ok(boredBooth.scores.scores.stopRate > boredSlogan.scores.scores.stopRate);
  assert.ok(boredBooth.scores.scores.relevance > boredSlogan.scores.scores.relevance);
});
