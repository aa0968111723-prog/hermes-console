import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HERMES_UNCONFIGURED_MESSAGE } from "../lib/contracts";

test("unconfigured Hermes send is student-facing and does not fake a task", async () => {
  assert.match(HERMES_UNCONFIGURED_MESSAGE, /Hermes 還沒連上/);
  assert.doesNotMatch(HERMES_UNCONFIGURED_MESSAGE, /環境變數/);
  const consoleUi = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  const hermes = await readFile(
    new URL("../lib/server/hermes.ts", import.meta.url),
    "utf8",
  );
  const health = await readFile(
    new URL("../lib/server/health-public.ts", import.meta.url),
    "utf8",
  );
  assert.match(consoleUi, /ready=\{\!\!health\}/);
  assert.match(consoleUi, /!health \|\| health\.credential !== "valid"/);
  assert.match(consoleUi, /HERMES_UNCONFIGURED_MESSAGE/);
  assert.match(consoleUi, /前往連線/);
  assert.match(consoleUi, /setConnectionFocus\("hermes"\)/);
  assert.match(consoleUi, /setSettingsTab\("連線"\)/);
  const connections = await readFile(
    new URL("../components/settings/ConnectionSettings.tsx", import.meta.url),
    "utf8",
  );
  assert.match(connections, /id="connection-hermes"/);
  assert.ok(
    connections.indexOf("className=\"connection-editor\"") <
      connections.indexOf("<IntegrationGrid"),
    "Hermes fields must appear before the connection grid",
  );
  assert.match(connections, /revealBelowStickyHeader/);
  assert.match(connections, /applyStickyReveal/);
  assert.match(connections, /ConnectionHelp/);
  assert.doesNotMatch(connections, /scrollIntoView\(\{ block: "start"/);
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /scroll-margin-top: 88px/);
  assert.ok(
    consoleUi.indexOf("health.credential !== \"valid\"") <
      consoleUi.indexOf("createConversation(text.trim())"),
    "must not create a conversation before Hermes is ready",
  );
  assert.match(hermes, /HERMES_UNCONFIGURED_MESSAGE/);
  assert.doesNotMatch(hermes, /請在連線設定或後端環境變數提供已確認/);
  assert.match(health, /HERMES_UNCONFIGURED_MESSAGE/);
});
