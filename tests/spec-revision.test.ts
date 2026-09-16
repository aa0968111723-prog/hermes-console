import test from "node:test";
import assert from "node:assert/strict";
import {
  applySpecRevision,
  isContinueSameWorkRequest,
  isMakeSelectedPosterRequest,
  isSpecRevisionRequest,
  specRevisionKind,
  specRevisionLabel,
} from "../lib/server/inspiration/revise";
import type { DirectionBriefPack } from "../lib/direction-brief";

const brief = (): DirectionBriefPack => ({
  kind: "direction_brief",
  selected: "A",
  title: "茶會",
  summary: "規格草稿",
  hermesGenerated: false,
  rendered: false,
  generatedImage: false,
  publish: false,
  formats: [
    {
      id: "ig_feed_4x5",
      label: "貼文",
      aspect: "4:5",
      width: 1080,
      height: 1350,
      compositionHint: "置中主標。",
    },
  ],
  copy: {
    a: "剛搬來淡水，晚上還在想社團要不要加？\n茶會來坐一下就好，沒有考試也沒有壓力。\n時間還沒確認。\n地點還沒定，確定再補。\n想去就填表。",
    b: "教授沒教的大腦休息法：週三晚上來坐一下。\n時間還沒確認。\n地點還沒定，確定再補。",
    c: "內向、怕被點名也沒關係。茶會可以只坐著聽。\n時間還沒確認。\n地點還沒定，確定再補。",
  },
  review: {} as unknown as DirectionBriefPack["review"],
  notice: "規則草稿，不是已出圖。",
});

test("spoken spec tweaks are revisions, not a new poster mill", () => {
  assert.equal(specRevisionKind("第二版字放大"), "type_enlarge");
  assert.equal(specRevisionKind("顏色改暖一點"), "warmer");
  assert.equal(specRevisionKind("語氣軟一點"), "softer");
  assert.equal(specRevisionKind("限動那句再短"), "shorter");
  assert.equal(specRevisionKind("幫我出圖"), null);
  assert.equal(specRevisionKind("再找靈感"), null);
  assert.equal(isSpecRevisionRequest("顏色改暖一點"), true);
  assert.equal(isSpecRevisionRequest("幫我出圖"), false);
  assert.equal(isMakeSelectedPosterRequest("幫我出圖"), true);
  assert.equal(isContinueSameWorkRequest("顏色改暖一點"), false);
  assert.equal(specRevisionLabel("warmer"), "配色偏暖");
});

test("rule revisions stack on the same unrendered spec", () => {
  const enlarged = applySpecRevision(brief(), "type_enlarge");
  assert.match(enlarged.visualNote || "", /主標加大/);
  assert.match(enlarged.visualNote || "", /規則修訂，不是出圖/);
  assert.equal(enlarged.rendered, false);
  const warmed = applySpecRevision(enlarged, "warmer");
  assert.match(warmed.visualNote || "", /主標加大/);
  assert.match(warmed.visualNote || "", /配色偏暖/);
  assert.equal(warmed.formats[0]?.compositionHint.startsWith("配色偏暖。"), true);
  const soft = applySpecRevision(warmed, "softer");
  assert.match(soft.copy.a, /想來再填也沒關係/);
  assert.doesNotMatch(soft.copy.a, /想去就填表/);
  const short = applySpecRevision(brief(), "shorter");
  assert.equal(short.copy.a.split("\n").includes("時間還沒確認。"), true);
  assert.doesNotMatch(short.copy.a, /沒有考試也沒有壓力/);
});
