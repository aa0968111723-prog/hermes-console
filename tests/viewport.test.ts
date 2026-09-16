import test from "node:test";
import assert from "node:assert/strict";
import {
  applyShellMetrics,
  applyStickyReveal,
  composerHeightLimit,
  detectComposerKeyboard,
  isLoginKeyboardTarget,
  readViewportFrame,
  shellMetrics,
  stickyRevealDelta,
  widthChanged,
} from "../lib/client/viewport";

test("keyboard open uses visualViewport height and offsetTop", () => {
  const frame = readViewportFrame(
    { width: 390, height: 420, offsetTop: 80, offsetLeft: 0, scale: 1 },
    { innerWidth: 390, innerHeight: 844 },
  );
  assert.equal(
    detectComposerKeyboard({
      composerFocused: true,
      widthChanged: false,
      frame,
      baselineHeight: 844,
    }),
    true,
  );
  assert.deepEqual(shellMetrics(frame, true), {
    height: 420,
    offsetTop: 80,
    keyboardOpen: true,
  });
});

test("keyboard closed restores CSS 100dvh instead of a stuck short height", () => {
  const frame = readViewportFrame(
    { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 },
    { innerWidth: 390, innerHeight: 844 },
  );
  assert.equal(
    detectComposerKeyboard({
      composerFocused: false,
      widthChanged: false,
      frame,
      baselineHeight: 844,
    }),
    false,
  );
  assert.deepEqual(shellMetrics(frame, false), {
    height: null,
    offsetTop: 0,
    keyboardOpen: false,
  });
  const dataset: { composerKeyboard?: string } = {};
  const properties: Record<string, string> = { "--app-height": "420px" };
  applyShellMetrics(
    {
      style: {
        setProperty(name, value) {
          properties[name] = value;
        },
        removeProperty(name) {
          delete properties[name];
        },
      },
      dataset,
    },
    { height: null, offsetTop: 0, keyboardOpen: false },
  );
  assert.equal(properties["--app-height"], undefined);
  assert.equal(properties["--app-offset-top"], "0px");
  assert.equal(dataset.composerKeyboard, undefined);
});

test("login keyboard target only matches fields inside the login screen", () => {
  assert.equal(isLoginKeyboardTarget(null), false);
});

test("sticky reveal leaves content already below the header in place", () => {
  assert.equal(
    stickyRevealDelta({
      nodeTop: 120,
      headerBottom: 68,
      scrollerBottom: 700,
    }),
    null,
  );
});

test("sticky reveal pulls a heading out from under the settings header", () => {
  assert.equal(
    stickyRevealDelta({
      nodeTop: 10,
      headerBottom: 68,
      scrollerBottom: 700,
    }),
    10 - 76,
  );
  const scroller = {
    scrollTop: 140,
    getBoundingClientRect: () => ({ top: 0, bottom: 700 }),
  };
  assert.equal(
    applyStickyReveal(
      { getBoundingClientRect: () => ({ top: 10 }) },
      scroller,
      { getBoundingClientRect: () => ({ bottom: 68 }) },
    ),
    true,
  );
  assert.equal(scroller.scrollTop, 140 + (10 - 76));
});

test("sticky reveal brings a below-the-fold editor just under the header", () => {
  const delta = stickyRevealDelta({
    nodeTop: 820,
    headerBottom: 68,
    scrollerBottom: 700,
  });
  assert.equal(delta, 820 - 76);
});

test("keyboard-open composer stays short enough to keep the caret on screen", () => {
  assert.equal(composerHeightLimit(true, 420), 92);
  assert.ok(composerHeightLimit(false, 420) > composerHeightLimit(true, 420));
});

test("rotation is not treated as a keyboard", () => {
  assert.equal(widthChanged(390, 844), true);
  const frame = readViewportFrame(
    { width: 844, height: 390, offsetTop: 0, offsetLeft: 0, scale: 1 },
    { innerWidth: 844, innerHeight: 390 },
  );
  assert.equal(
    detectComposerKeyboard({
      composerFocused: true,
      widthChanged: true,
      frame,
      baselineHeight: 844,
    }),
    false,
  );
});
