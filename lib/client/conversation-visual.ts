export const CONVERSATION_VISUAL_SELECTOR =
  ".inspiration-result, .image-review, .direction-brief";

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
