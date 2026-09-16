import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("chat shell is extracted from HermesConsole into TopBar and Conversation", async () => {
  const consoleUi = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  const topBar = await readFile(
    new URL("../components/console/TopBar.tsx", import.meta.url),
    "utf8",
  );
  const conversation = await readFile(
    new URL("../components/console/Conversation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(consoleUi, /console\/TopBar/);
  assert.match(consoleUi, /console\/Conversation/);
  assert.doesNotMatch(consoleUi, /className="topbar"/);
  assert.doesNotMatch(consoleUi, /className="conversation-scroll"/);
  assert.match(topBar, /className="topbar"/);
  assert.match(topBar, /創作對話/);
  assert.match(topBar, /aria-label="開啟新對話"/);
  assert.match(topBar, /aria-label="帳號設定"/);
  assert.match(topBar, /data-ready=/);
  assert.match(topBar, /const hideTitle = mobile;/);
  assert.match(topBar, /data-compact-title=\{hideTitle \? "true" : "false"\}/);
  assert.match(topBar, /!hideTitle && \(/);
  assert.doesNotMatch(topBar, /mobile\s*\?\s*"Hermes"/);
  assert.doesNotMatch(topBar, /chatHome/);
  assert.match(consoleUi, /onNewChat=\{fresh\}/);
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.mobile-nav \.visual-dock-nav \{\s*display: none;/);
  assert.match(css, /\.topbar-title \{[\s\S]*?overflow: hidden/);
  assert.match(
    css,
    /connection-pill\[data-ready="true"\] \.connection-label \{ display: none/,
  );
  assert.match(
    css,
    /data-composer-keyboard="open"\] \.welcome \{\s*display: none/,
  );
  assert.doesNotMatch(
    css,
    /\.connection-label \{ display: none; \}\.connection-pill \{ width: 44px/,
  );
  assert.match(conversation, /className="conversation-scroll"/);
  assert.match(conversation, /今天想做什麼？/);
  assert.match(conversation, /onPickDirection/);
  assert.match(conversation, /VisualMessage/);
  assert.match(conversation, /ResizeObserver/);
  assert.match(consoleUi, /onOpenMaterial=\{openMaterial\}/);
  assert.match(consoleUi, /directionFollowUp/);
  assert.match(consoleUi, /function pinConversation/);
  assert.match(consoleUi, /function openPanel/);
  assert.match(consoleUi, /panelOpener/);
  assert.match(consoleUi, /if \(node && !node\.open\)/);
  assert.match(consoleUi, /dialog\.current\?\.open/);
  assert.match(css, /\.jump-button \{[\s\S]*?position: relative/);
  assert.match(css, /\.jump-button \{[\s\S]*?min-height: 44px/);
  assert.doesNotMatch(css, /\.jump-button \{[\s\S]*?bottom: 100%/);
});
