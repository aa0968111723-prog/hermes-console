export const CONVERSATION_VISUAL_SELECTOR =
  ".inspiration-result, .image-review, .direction-brief, .knowledge-result, .first-reaction-board";

/** Pin these first. Twin boards sit under 畫面審查 and must not steal the scroll. */
export const RESULT_VISUAL_SELECTOR =
  ".inspiration-result, .image-review, .knowledge-result";

/** Club facts / poster review after a spec must win over the trailing 規格草稿. */
export const FOLLOWUP_VISUAL_SELECTOR = ".knowledge-result, .image-review";

export const AUDIENCE_VISUAL_SELECTOR = ".first-reaction-board";

export function lastMatchingVisual(
  root: { querySelectorAll: (selector: string) => ArrayLike<Element> },
  selector: string,
): HTMLElement | null {
  const nodes = root.querySelectorAll(selector);
  if (!nodes.length) return null;
  return nodes[nodes.length - 1] as HTMLElement;
}

/** Club facts / poster review, then the trailing spec, then inspiration, then twin. */
export function preferredPinnedVisual(
  root: { querySelectorAll: (selector: string) => ArrayLike<Element> },
  pinBrief: boolean,
): HTMLElement | null {
  return (
    lastMatchingVisual(root, FOLLOWUP_VISUAL_SELECTOR) ||
    (pinBrief ? lastMatchingVisual(root, ".direction-brief") : null) ||
    lastMatchingVisual(root, RESULT_VISUAL_SELECTOR) ||
    lastMatchingVisual(root, AUDIENCE_VISUAL_SELECTOR)
  );
}

export function visualIntersectsScrollport(
  root: { top: number; bottom: number },
  box: { top: number; bottom: number },
  inset = 24,
) {
  return box.top < root.bottom - inset && box.bottom > root.top + inset;
}

export function conversationVisualInView(
  root: { top: number; bottom: number },
  boxes: Array<{ top: number; bottom: number }>,
) {
  return boxes.some((box) => visualIntersectsScrollport(root, box));
}
