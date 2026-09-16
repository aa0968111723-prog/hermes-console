import test from "node:test";
import assert from "node:assert/strict";
import { conversationVisualInView } from "../lib/client/conversation-visual";

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
