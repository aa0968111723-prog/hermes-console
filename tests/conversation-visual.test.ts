import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIENCE_VISUAL_SELECTOR,
  FOLLOWUP_VISUAL_SELECTOR,
  RESULT_VISUAL_SELECTOR,
  conversationVisualInView,
  lastMatchingVisual,
  preferredPinnedVisual,
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

test("club facts after a spec win over the trailing direction brief", () => {
  const inspiration = { id: "inspiration" } as unknown as HTMLElement;
  const knowledge = { id: "knowledge" } as unknown as HTMLElement;
  const review = { id: "review" } as unknown as HTMLElement;
  const brief = { id: "brief" } as unknown as HTMLElement;
  const twin = { id: "twin" } as unknown as HTMLElement;
  const withClubFacts = {
    querySelectorAll: (selector: string) => {
      if (selector === FOLLOWUP_VISUAL_SELECTOR) return [knowledge];
      if (selector === ".direction-brief") return [brief];
      if (selector === RESULT_VISUAL_SELECTOR) return [inspiration, knowledge];
      if (selector === AUDIENCE_VISUAL_SELECTOR) return [twin];
      return [];
    },
  };
  const withPosterReview = {
    querySelectorAll: (selector: string) => {
      if (selector === FOLLOWUP_VISUAL_SELECTOR) return [knowledge, review];
      if (selector === ".direction-brief") return [brief];
      if (selector === RESULT_VISUAL_SELECTOR)
        return [inspiration, knowledge, review];
      if (selector === AUDIENCE_VISUAL_SELECTOR) return [twin];
      return [];
    },
  };
  const specOnly = {
    querySelectorAll: (selector: string) => {
      if (selector === FOLLOWUP_VISUAL_SELECTOR) return [];
      if (selector === ".direction-brief") return [brief];
      if (selector === RESULT_VISUAL_SELECTOR) return [inspiration];
      return [];
    },
  };
  const inspirationOnly = {
    querySelectorAll: (selector: string) => {
      if (selector === FOLLOWUP_VISUAL_SELECTOR) return [];
      if (selector === RESULT_VISUAL_SELECTOR) return [inspiration];
      if (selector === AUDIENCE_VISUAL_SELECTOR) return [twin];
      return [];
    },
  };
  assert.equal(preferredPinnedVisual(withClubFacts, true), knowledge);
  assert.equal(preferredPinnedVisual(withPosterReview, true), review);
  assert.equal(preferredPinnedVisual(specOnly, true), brief);
  assert.equal(preferredPinnedVisual(inspirationOnly, false), inspiration);
  assert.notEqual(preferredPinnedVisual(inspirationOnly, false), twin);
  assert.equal(preferredPinnedVisual(withClubFacts, true, true), brief);
});
