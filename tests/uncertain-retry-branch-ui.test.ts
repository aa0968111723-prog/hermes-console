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
  const sheet = await readFile(
    new URL("../components/console/TaskSheet.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /function retryBranchFromTask/);
  // composer / task-list path still gates failed|cancelled|uncertain together
  assert.match(
    ui,
    /\["failed", "cancelled", "uncertain"\]\.includes\(\s*currentTask\.state/,
  );
  assert.match(ui, /acknowledgeTask/);
  assert.match(ui, /retryBranchFromTask/);
  assert.match(ui, /composer-uncertain-actions/);
  assert.match(ui, /結果待確認/);
  assert.match(ui, /確認並可重試/);
  assert.match(ui, /建立重試分支/);
  assert.match(ui, /action:\s*"acknowledge"/);
  assert.match(sheet, /task\.state === "uncertain"/);
  assert.match(sheet, /onAcknowledge\(task\)/);
  assert.match(sheet, /onRetryBranch\(task\)/);
  assert.match(sheet, /task-uncertain-block/);
  assert.match(sheet, /系統不會自動重送上一則/);
});
