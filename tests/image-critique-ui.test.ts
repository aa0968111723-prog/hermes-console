import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { simulateFreshmanReactions } from "../lib/server/audience/personas";
import {
  critiqueDirections,
  critiqueFollowUp,
  critiqueLayers,
  isImageRead,
} from "../lib/client/image-critique";

test("image read is a poster preview, not a fake pixel score", async () => {
  const read = {
    materialId: "11111111-1111-1111-1111-111111111111",
    kind: "image" as const,
    mime: "image/png",
    title: "tea-poster.png",
    imageRead: true as const,
    nativeImageInput: false,
    notice: "已讀取上傳畫面並交給工具。原生對話插圖尚未開啟，不把檔名當成已看過。",
  };
  assert.equal(isImageRead(read), true);
  assert.equal(
    isImageRead({
      ...read,
      notice: "已看完整像素，轉換率 98%",
    }),
    false,
  );
  assert.equal(
    isImageRead({
      materialId: read.materialId,
      kind: "text",
      imageRead: false,
      nativeImageInput: false,
      notice: "已讀取文字內容，不是圖片分析。",
    }),
    false,
  );
  const panel = simulateFreshmanReactions({
    kind: "poster",
    title: "禪學社茶會",
    copy: "歡迎參加",
  });
  const layers = critiqueLayers(read, panel);
  assert.equal(layers[0]?.state, "已讀取");
  assert.equal(layers[1]?.state, "UNKNOWN");
  const directions = critiqueDirections(panel);
  assert.ok(directions.some((item) => /視覺|看圖/.test(item)));
  assert.match(critiqueFollowUp("標題加大"), /沿用同一張圖/);
  const ui = await readFile(
    new URL("../components/visual/VisualMessage.tsx", import.meta.url),
    "utf8",
  );
  const board = await readFile(
    new URL("../components/visual/ImageCritiqueResult.tsx", import.meta.url),
    "utf8",
  );
  const live = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  const twins = await readFile(
    new URL("../components/audience/FirstReactionBoard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /ImageCritiqueResult/);
  assert.match(board, /畫面 · 已讀取/);
  assert.match(board, /依這個改/);
  assert.match(live, /onOpenMaterial=\{openMaterial\}/);
  assert.match(twins, /tabIndex=\{0\}/);
  assert.doesNotMatch(board, /toolCallId|inputSchema|轉換率|已搜尋整個 Instagram/);
  assert.doesNotMatch(ui, /traceId|credentialReference/);
});
