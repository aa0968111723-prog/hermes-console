import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * LOCAL_CONTRACT — uncertain tasks should expose both in-place acknowledge and
 * conversation retry-branch, matching failed/cancelled recovery.
 * Not LIVE_EXTERNAL. Does not execute React.
 */
test("uncertain UI offers acknowledge and retry branch alongside failed/cancelled", async () => {
  const ui = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /function retryBranchFromTask/);
  assert.match(
    ui,
    /\["failed", "cancelled", "uncertain"\]\.includes\(\s*currentTask\.state/,
  );
  assert.match(
    ui,
    /\["failed", "cancelled", "uncertain"\]\.includes\(\s*chosenTask\.state/,
  );
  assert.match(ui, /composer-uncertain-actions/);
  assert.match(ui, /確認並可重試/);
  assert.match(ui, /建立重試分支（保留原紀錄）/);
  assert.match(
    ui,
    /可確認後在原對話重試，或建立分支保留原紀錄；未宣稱遠端已停止/,
  );
});
