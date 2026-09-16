import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("tasks page uses DirectionPick and ArtifactDeck, not a second copy grid", async () => {
  const consoleUi = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  const page = await readFile(
    new URL("../components/console/TasksPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(consoleUi, /console\/TasksPage/);
  assert.doesNotMatch(consoleUi, /選擇這個方向/);
  assert.doesNotMatch(consoleUi, /direction-grid/);
  assert.match(page, /DirectionPick/);
  assert.match(page, /ArtifactDeck/);
  assert.match(page, /用這個方向|onPick=\{onPickDirection\}/);
  assert.match(page, /查回 Canva 製作結果/);
  assert.doesNotMatch(page, /視覺、文案與來源/);
  assert.doesNotMatch(page, /toolCallId|credentialReference/);
});
