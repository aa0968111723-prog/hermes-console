import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * LOCAL_CONTRACT — uncertain tasks expose acknowledge + retry-branch.
 * P4 splits uncertain into its own sheet block (not failed/cancelled includes).
 * Not LIVE_EXTERNAL. Does not execute React.
 */
test("uncertain UI offers acknowledge and retry branch alongside failed/cancelled", async () => {
  const ui = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /function retryBranchFromTask/);
  // composer / task-list path still gates failed|cancelled|uncertain together
  assert.match(
    ui,
    /\["failed", "cancelled", "uncertain"\]\.includes\(\s*currentTask\.state/,
  );
  // P4 sheet: independent uncertain block + CTAs on chosenTask
  assert.match(ui, /chosenTask\.state === "uncertain"/);
  assert.match(ui, /acknowledgeTask\(chosenTask\)/);
  assert.match(ui, /retryBranchFromTask\(chosenTask\)/);
  assert.match(ui, /task-uncertain-block/);
  assert.match(ui, /composer-uncertain-actions/);
  assert.match(ui, /結果待確認/);
  assert.match(ui, /確認並可重試/);
  assert.match(ui, /系統不會自動重送上一則/);
  assert.match(ui, /建立重試分支/);
  assert.match(ui, /action:\s*"acknowledge"/);
});
