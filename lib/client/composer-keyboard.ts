export type ComposerKeyboardInput = {
  composerFocused: boolean;
  widthChanged: boolean;
  baselineHeight: number;
  layoutHeight: number;
  visualHeight: number;
  scale: number;
};

export function isComposerKeyboardOpen(input: ComposerKeyboardInput) {
  return (
    input.composerFocused &&
    !input.widthChanged &&
    Math.max(input.baselineHeight, input.layoutHeight) - input.visualHeight >=
      96 &&
    input.scale <= 1.01
  );
}

/**
 * Bind the app shell to visualViewport only while the software keyboard owns
 * the composer. Closed keyboards must fall back to CSS `--app-height: 100dvh`
 * so Android Chrome URL-bar / keyboard close cannot leave a permanently short
 * shell with blank space under the dock.
 */
export function composerAppHeightPx(input: {
  keyboardOpen: boolean;
  visualHeight: number;
}): number | null {
  if (!input.keyboardOpen) return null;
  return input.visualHeight;
}

export function applyComposerKeyboardStyle(
  root: HTMLElement,
  input: { keyboardOpen: boolean; visualHeight: number },
) {
  const height = composerAppHeightPx(input);
  if (height == null) {
    root.style.removeProperty("--app-height");
    delete root.dataset.composerKeyboard;
    return;
  }
  root.style.setProperty("--app-height", height + "px");
  root.dataset.composerKeyboard = "open";
}

export function clearComposerKeyboardStyle(root: HTMLElement) {
  root.style.removeProperty("--app-height");
  delete root.dataset.composerKeyboard;
}

/** Spoken send must not reopen the keyboard over the new cards. Typed send may. */
export function shouldFocusComposerAfterSend(spoken: boolean) {
  return !spoken;
}
