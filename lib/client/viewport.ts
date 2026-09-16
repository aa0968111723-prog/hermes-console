export function visualKeyboardOpen(input: {
  ownerFocused: boolean;
  layoutHeight: number;
  visualHeight: number;
  scale?: number;
  ignore?: boolean;
}) {
  if (!input.ownerFocused || input.ignore) return false;
  if ((input.scale ?? 1) > 1.01) return false;
  return (
    Math.max(input.layoutHeight, input.visualHeight) - input.visualHeight >= 96
  );
}

export function applyAppViewport(ownerFocused: boolean, ignore = false) {
  const viewport = window.visualViewport;
  const layoutHeight = window.innerHeight;
  const visualHeight = viewport?.height || layoutHeight;
  const keyboardOpen = visualKeyboardOpen({
    ownerFocused,
    layoutHeight,
    visualHeight,
    scale: viewport?.scale || 1,
    ignore,
  });
  document.documentElement.style.setProperty(
    "--app-height",
    (keyboardOpen ? visualHeight : layoutHeight) + "px",
  );
  document.documentElement.style.setProperty(
    "--app-top",
    (keyboardOpen ? viewport?.offsetTop || 0 : 0) + "px",
  );
  if (keyboardOpen) document.documentElement.dataset.composerKeyboard = "open";
  else delete document.documentElement.dataset.composerKeyboard;
  return keyboardOpen;
}
