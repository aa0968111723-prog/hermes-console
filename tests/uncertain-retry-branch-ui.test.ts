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
  const conversation = await readFile(
    new URL("../components/console/Conversation.tsx", import.meta.url),
    "utf8",
  );
  const composer = await readFile(
    new URL("../components/console/Composer.tsx", import.meta.url),
    "utf8",
  );
  const sheet = await readFile(
    new URL("../components/console/TaskSheet.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /function retryBranchFromTask/);
  // conversation live bubble still gates failed|cancelled|uncertain together
  assert.match(
    conversation,
    /\["failed", "cancelled", "uncertain"\]\.includes\(\s*currentTask\.state/,
  );
  assert.match(ui, /acknowledgeTask/);
  assert.match(ui, /retryBranchFromTask/);
  assert.match(composer, /composer-uncertain-actions/);
  assert.match(composer, /結果待確認/);
  assert.match(composer, /確認並可重試/);
  assert.match(conversation, /建立重試分支/);
  assert.match(ui, /action:\s*"acknowledge"/);
  assert.match(sheet, /task\.state === "uncertain"/);
  assert.match(sheet, /onAcknowledge\(task\)/);
  assert.match(sheet, /onRetryBranch\(task\)/);
  assert.match(sheet, /task-uncertain-block/);
  assert.match(sheet, /系統不會自動重送上一則/);
});
