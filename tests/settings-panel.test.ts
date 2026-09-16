import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("settings shell is extracted and still hosts Help plus five tabs", async () => {
  const consoleUi = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  const panel = await readFile(
    new URL("../components/settings/SettingsPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(consoleUi, /settings\/SettingsPanel/);
  assert.doesNotMatch(consoleUi, /<h3>說明<\/h3>/);
  assert.match(panel, /HelpPage/);
  assert.match(panel, /<h3>說明<\/h3>/);
  assert.match(panel, /["']帳號["'], ["']外觀["'], ["']連線["'], ["']工作區["'], ["']進階["']/);
  assert.doesNotMatch(panel, /校園密碼|以校園憑證|tkuPassword/);
  assert.match(panel, /conversations\?id=" \+ conversationId/);
  assert.match(panel, /knowledge\/KnowledgeArchive/);
  assert.match(panel, /進階 · Drive 知識/);
  assert.match(panel, /進階 · 工具、技能與驗證證據/);
  assert.doesNotMatch(panel, /Advanced ·/);
  assert.match(panel, /pendingTabFocus/);
  assert.match(panel, /closest\("dialog\[open\]"\)/);
  assert.doesNotMatch(
    panel,
    /id="setting-panel"[\s\S]{0,80}tabIndex=\{0\}/,
  );
  assert.match(panel, /健康與驗證/);
  assert.match(panel, /settingsTab === "進階"/);
  assert.match(panel, /金鑰只存在伺服器/);
  assert.doesNotMatch(panel, /單一工作區 · 秘密只存在後端/);
  assert.doesNotMatch(panel, /Settings → API Keys/);
  assert.ok(
    panel.indexOf("<ConnectionSettings") < panel.indexOf("健康與驗證"),
    "credential fields must appear before health internals",
  );
});
