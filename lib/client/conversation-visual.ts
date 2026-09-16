export const CONVERSATION_VISUAL_SELECTOR =
  ".inspiration-result, .image-review, .direction-brief, .knowledge-result";

export const RESULT_VISUAL_SELECTOR =
  ".inspiration-result, .image-review, .knowledge-result";

export function lastMatchingVisual(
  root: { querySelectorAll: (selector: string) => ArrayLike<Element> },
  selector: string,
): HTMLElement | null {
  const nodes = root.querySelectorAll(selector);
  if (!nodes.length) return null;
  return nodes[nodes.length - 1] as HTMLElement;
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
