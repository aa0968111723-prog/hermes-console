import test from "node:test";
import assert from "node:assert/strict";
import {
  applyComposerKeyboardStyle,
  clearComposerKeyboardStyle,
  composerAppHeightPx,
  isComposerKeyboardOpen,
} from "../lib/client/composer-keyboard";

test("composer keyboard is only open when focus owns a shrunk visual viewport", () => {
  const open = {
    composerFocused: true,
    widthChanged: false,
    baselineHeight: 844,
    layoutHeight: 844,
    visualHeight: 420,
    scale: 1,
  };
  assert.equal(isComposerKeyboardOpen(open), true);
  assert.equal(composerAppHeightPx({ keyboardOpen: true, visualHeight: 420 }), 420);
  assert.equal(
    isComposerKeyboardOpen({ ...open, composerFocused: false }),
    false,
  );
  assert.equal(isComposerKeyboardOpen({ ...open, widthChanged: true }), false);
  assert.equal(isComposerKeyboardOpen({ ...open, visualHeight: 800 }), false);
  assert.equal(isComposerKeyboardOpen({ ...open, scale: 1.2 }), false);
});

test("closed keyboard does not keep a visualViewport pixel height", () => {
  assert.equal(
    composerAppHeightPx({ keyboardOpen: false, visualHeight: 420 }),
    null,
  );
});

test("app-height inline style is cleared when the keyboard closes", () => {
  const root = {
    style: new Map<string, string>(),
    dataset: {} as Record<string, string>,
  };
  const element = {
    style: {
      setProperty(name: string, value: string) {
        root.style.set(name, value);
      },
      removeProperty(name: string) {
        root.style.delete(name);
      },
    },
    dataset: root.dataset,
  } as unknown as HTMLElement;
  applyComposerKeyboardStyle(element, { keyboardOpen: true, visualHeight: 420 });
  assert.equal(root.style.get("--app-height"), "420px");
  assert.equal(root.dataset.composerKeyboard, "open");
  applyComposerKeyboardStyle(element, { keyboardOpen: false, visualHeight: 420 });
  assert.equal(root.style.has("--app-height"), false);
  assert.equal("composerKeyboard" in root.dataset, false);
  applyComposerKeyboardStyle(element, { keyboardOpen: true, visualHeight: 390 });
  clearComposerKeyboardStyle(element);
  assert.equal(root.style.has("--app-height"), false);
  assert.equal("composerKeyboard" in root.dataset, false);
});
