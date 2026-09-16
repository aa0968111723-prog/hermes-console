import test from "node:test";
import assert from "node:assert/strict";
import {
  RESULT_VISUAL_SELECTOR,
  conversationVisualInView,
  lastMatchingVisual,
} from "../lib/client/conversation-visual";

test("jump chip hides when a later spec card is in view even if inspiration is above", () => {
  const root = { top: 60, bottom: 640 };
  const inspirationAbove = { top: -400, bottom: 20 };
  const specInView = { top: 80, bottom: 900 };
  assert.equal(
    conversationVisualInView(root, [inspirationAbove, specInView]),
    true,
  );
  assert.equal(conversationVisualInView(root, [inspirationAbove]), false);
});

test("later image review wins over an earlier knowledge card", () => {
  const knowledge = { id: "knowledge" } as unknown as HTMLElement;
  const review = { id: "review" } as unknown as HTMLElement;
  const twin = { id: "twin" } as unknown as HTMLElement;
  const root = {
    querySelectorAll: (selector: string) => {
      if (selector === RESULT_VISUAL_SELECTOR) return [knowledge, review];
      return [twin];
    },
  };
  assert.equal(lastMatchingVisual(root, RESULT_VISUAL_SELECTOR), review);
  assert.notEqual(lastMatchingVisual(root, RESULT_VISUAL_SELECTOR), twin);
  assert.equal(
    lastMatchingVisual({ querySelectorAll: () => [] }, RESULT_VISUAL_SELECTOR),
    null,
  );
});
