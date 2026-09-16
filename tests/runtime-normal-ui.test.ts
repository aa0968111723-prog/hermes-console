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
  assert.doesNotMatch(inspector, /runtime-advanced" open/);
  assert.match(inspector, /進階 · 工具/);
  assert.match(inspector, /進階 · Runtime/);
  const advancedAt = inspector.indexOf('className="runtime-advanced"');
  const orbitAt = inspector.indexOf("<AgentOrbit");
  assert.ok(advancedAt > 0, "developer runtime details must exist");
  assert.ok(orbitAt > advancedAt, "capability orbit stays inside 進階 · Runtime");
  assert.doesNotMatch(inspector.slice(0, advancedAt), /<AgentOrbit/);
  const orbit = await readFile(
    new URL("../components/visual/AgentOrbit.tsx", import.meta.url),
    "utf8",
  );
  assert.match(orbit, /chosen && !compact/);
  assert.doesNotMatch(consoleUi, /Agent Runtime/);
  assert.doesNotMatch(consoleUi, /KnowledgeArchive/);
  assert.match(consoleUi, /進階 · Agent 設定檔/);
});
