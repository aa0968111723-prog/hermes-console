import test from "node:test";
import assert from "node:assert/strict";
import {
  applyShellMetrics,
  detectComposerKeyboard,
  readViewportFrame,
  shellMetrics,
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
