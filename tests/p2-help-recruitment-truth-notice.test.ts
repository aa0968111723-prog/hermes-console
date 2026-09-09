import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { RECRUITMENT_TRUTH_NOTICE } from "../lib/client/recruitment-truth";

/**
 * LOCAL_CONTRACT — P2 Help soft notice on Inspiration + Help copy.
 * Does not execute React. No funnel/lane API changes.
 */
test("recruitment truth notice copy is exact and wired to Inspiration + Help", async () => {
  assert.equal(
    RECRUITMENT_TRUTH_NOTICE,
    "招生真相看漏斗契約與 Drive FACT；靈感表（Sheets sync）只作文宣參考，不是名單。",
  );

  const notice = await readFile(
    new URL("../components/help/RecruitmentTruthNotice.tsx", import.meta.url),
    "utf8",
  );
  const help = await readFile(
    new URL("../components/help/HelpPage.tsx", import.meta.url),
    "utf8",
  );
  const board = await readFile(
    new URL("../components/inspiration/InspirationBoard.tsx", import.meta.url),
    "utf8",
  );
  const consoleUi = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(notice, /soft-info-notice/);
  assert.match(notice, /RECRUITMENT_TRUTH_NOTICE/);
  assert.match(notice, /RECRUITMENT_TRUTH_NOTICE_DISMISSED_KEY/);
  assert.doesNotMatch(notice, /role=["']dialog["']/);
  assert.match(help, /RECRUITMENT_TRUTH_NOTICE/);
  assert.match(help, /help-recruitment-truth/);
  assert.match(board, /RecruitmentTruthNotice/);
  assert.match(consoleUi, /HelpPage/);
  assert.match(consoleUi, /"說明"/);
  assert.ok(css.includes(".soft-info-notice"));
  assert.ok(css.includes("max-width: 430px"));
  // dismiss hit target >=44x44 (was 32)
  assert.match(css, /\.soft-info-notice-dismiss\s*\{[\s\S]*?min-width:\s*44px/);
  assert.match(css, /\.soft-info-notice-dismiss\s*\{[\s\S]*?min-height:\s*44px/);
  assert.doesNotMatch(css, /\.soft-info-notice-dismiss\s*\{[\s\S]*?\b(?:width|height|min-height):\s*32px/);
});
