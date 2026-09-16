import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("inspiration main surface is visual patterns; research stays in closed 進階", async () => {
  const board = await readFile(
    new URL("../components/inspiration/InspirationBoard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(board, /值得學/);
  assert.match(board, /先避開/);
  assert.match(board, /inspiration-research/);
  assert.match(board, /進階 · 研究/);
  assert.match(board, /RecruitmentTruthNotice/);
  assert.match(board, /RecruitmentFunnelFold/);
  assert.match(board, /hostLabel/);
  assert.doesNotMatch(board, /eyebrow">參考板/);
  assert.doesNotMatch(board, /style=\{\{ minHeight: 44 \}\}/);
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.inspiration-board \.pattern-card/);
  assert.match(css, /\.inspiration-research > summary/);
  assert.match(css, /\.inspiration-result \.pattern-card/);
  const research = board.slice(board.indexOf("inspiration-research"));
  assert.match(research, /Feed EVIDENCE/);
  assert.match(research, /給 Visual Agent/);
  assert.ok(
    board.indexOf("值得學") < board.indexOf("inspiration-research"),
    "pattern grids must appear before the research fold",
  );
  const ui = await readFile(new URL("./verify-ui.ts", import.meta.url), "utf8");
  assert.match(ui, /inspiration-mobile\.png/);
  assert.match(ui, /inspiration-avoid-mobile\.png/);
  assert.match(ui, /project-preview-mobile\.png/);
  const engines = await readFile(
    new URL("./mobile-engines.ts", import.meta.url),
    "utf8",
  );
  assert.match(engines, /"靈感", "inspiration", "靈感"/);
  assert.match(engines, /aria-current", "page"/);
});
