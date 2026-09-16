import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("agent tab shows four status dots; tool lists stay in closed developer details", async () => {
  const inspector = await readFile(
    new URL("../components/RuntimeInspector.tsx", import.meta.url),
    "utf8",
  );
  const consoleUi = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  assert.match(inspector, /aria-label="Hermes 狀態"/);
  assert.match(inspector, />Hermes<\//);
  assert.match(inspector, />Memory<\//);
  assert.match(inspector, />Tools<\//);
  assert.match(inspector, />MCP<\//);
  assert.doesNotMatch(inspector, /availableTools\/\$\{snapshot\.tools\.length\}/);
  assert.doesNotMatch(inspector, /runtime-developer" open/);
  assert.match(inspector, /進階 · 工具/);
  assert.doesNotMatch(consoleUi, /Agent Runtime/);
  assert.doesNotMatch(consoleUi, /KnowledgeArchive/);
  assert.match(consoleUi, /進階 · Agent 設定檔/);
});
