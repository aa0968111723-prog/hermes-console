import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("project workbench compose prompts stay student-facing without tool names or ids", async () => {
  const workbench = await readFile(
    new URL("../components/ProjectWorkbench.tsx", import.meta.url),
    "utf8",
  );
  const consoleUi = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  assert.match(workbench, /CONTINUE_SAME_WORK_PROMPT/);
  assert.match(workbench, /hermesReady/);
  assert.match(workbench, /Hermes 尚未連線/);
  assert.doesNotMatch(workbench, /workspace_get_copy/);
  assert.doesNotMatch(workbench, /workspace_review_copy/);
  assert.doesNotMatch(workbench, /workspace_project_context/);
  assert.doesNotMatch(workbench, /請讀取活動 \$\{/);
  assert.doesNotMatch(workbench, /查回方向流程 \$\{/);
  assert.match(consoleUi, /onCompose=\{\(text, conversationId\)/);
  assert.match(consoleUi, /hermesReady=\{hermesCanContinue\(health\)\}/);
  assert.match(consoleUi, /canvaReady=\{hermesCanContinue\(health\)\}/);
  const menu = await readFile(
    new URL("../components/visual/ComposerMenu.tsx", import.meta.url),
    "utf8",
  );
  const dock = await readFile(
    new URL("../components/visual/AppDock.tsx", import.meta.url),
    "utf8",
  );
  assert.match(menu, /canvaReady/);
  assert.match(dock, /canvaReady/);
});
