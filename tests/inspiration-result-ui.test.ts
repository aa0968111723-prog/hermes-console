import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  inspirationDirectionPrompt,
  isInspirationBrief,
} from "../lib/client/inspiration-result";

test("inspiration brief is visual clustering, not a full-site search claim", async () => {
  assert.equal(
    isInspirationBrief({
      fullSiteSearch: false,
      instagramConnected: false,
      notice: "已保存參考與社團視覺模式快照。",
      visualLanguage: {
        biggestProblem: "封面每篇換一套畫風",
        keep: [
          {
            id: "design-turtle-student",
            kind: "design",
            suitability: "keep",
            title: "2D 龜龜＋學生插畫",
            summary: "可辨識角色",
          },
        ],
        avoid: [],
      },
    }),
    true,
  );
  assert.equal(
    isInspirationBrief({
      fullSiteSearch: true,
      instagramConnected: false,
      notice: "已搜尋整個 Instagram",
      visualLanguage: { keep: [] },
    }),
    false,
  );
  assert.match(inspirationDirectionPrompt("2D 龜龜＋學生插畫"), /不要另起無關作品/);
  const ui = await readFile(
    new URL("../components/visual/VisualMessage.tsx", import.meta.url),
    "utf8",
  );
  const board = await readFile(
    new URL("../components/visual/InspirationResult.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /InspirationResult/);
  assert.match(board, /用這個方向/);
  assert.match(board, /靈感 · 已保存來源/);
  assert.doesNotMatch(board, /已搜尋整個 Instagram|toolCallId|inputSchema/);
  assert.doesNotMatch(ui, /traceId|credentialReference/);
});
