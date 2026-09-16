import test from "node:test";
import assert from "node:assert/strict";
import { visualKeyboardOpen } from "../lib/client/viewport";

test("shell follows the layout viewport unless a focused composer owns the keyboard", () => {
  assert.equal(
    visualKeyboardOpen({
      ownerFocused: true,
      layoutHeight: 844,
      visualHeight: 420,
    }),
    true,
  );
  assert.equal(
    visualKeyboardOpen({
      ownerFocused: false,
      layoutHeight: 844,
      visualHeight: 420,
    }),
    false,
  );
  assert.equal(
    visualKeyboardOpen({
      ownerFocused: true,
      layoutHeight: 844,
      visualHeight: 420,
      ignore: true,
    }),
    false,
  );
  assert.equal(
    visualKeyboardOpen({
      ownerFocused: true,
      layoutHeight: 844,
      visualHeight: 844,
    }),
    false,
  );
  assert.equal(
    visualKeyboardOpen({
      ownerFocused: true,
      layoutHeight: 844,
      visualHeight: 420,
      scale: 2,
    }),
    false,
  );
});
