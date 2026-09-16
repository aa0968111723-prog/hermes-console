export type ViewportFrame = {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
  scale: number;
  innerWidth: number;
  innerHeight: number;
};

export type ShellMetrics = {
  height: number | null;
  offsetTop: number;
  keyboardOpen: boolean;
};

const KEYBOARD_INSET_PX = 96;
const KEYBOARD_OFFSET_PX = 24;
const WIDTH_CHANGE_PX = 16;

export function readViewportFrame(
  viewport: {
    width: number;
    height: number;
    offsetTop: number;
    offsetLeft: number;
    scale: number;
  } | null,
  win: { innerWidth: number; innerHeight: number },
): ViewportFrame {
  return {
    width: viewport?.width || win.innerWidth,
    height: viewport?.height || win.innerHeight,
    offsetTop: viewport?.offsetTop || 0,
    offsetLeft: viewport?.offsetLeft || 0,
    scale: viewport?.scale || 1,
    innerWidth: win.innerWidth,
    innerHeight: win.innerHeight,
  };
}

export function detectComposerKeyboard(input: {
  composerFocused: boolean;
  widthChanged: boolean;
  frame: ViewportFrame;
  baselineHeight: number;
}): boolean {
  if (!input.composerFocused || input.widthChanged) return false;
  if (input.frame.scale > 1.01) return false;
  const heightDrop =
    Math.max(input.baselineHeight, input.frame.innerHeight) - input.frame.height;
  return (
    heightDrop >= KEYBOARD_INSET_PX || input.frame.offsetTop >= KEYBOARD_OFFSET_PX
  );
}

export function composerHeightLimit(
  keyboardOpen: boolean,
  viewHeight: number,
) {
  const cap = keyboardOpen ? 96 : 190;
  const min = keyboardOpen ? 44 : 66;
  const ratio = keyboardOpen ? 0.22 : 0.28;
  return Math.max(min, Math.min(cap, Math.floor(viewHeight * ratio)));
}

export function shellMetrics(
  frame: ViewportFrame,
  keyboardOpen: boolean,
): ShellMetrics {
  if (!keyboardOpen) {
    return { height: null, offsetTop: 0, keyboardOpen: false };
  }
  return {
    height: Math.round(frame.height),
    offsetTop: Math.round(Math.max(0, frame.offsetTop)),
    keyboardOpen: true,
  };
}

export function widthChanged(previous: number, current: number) {
  return Math.abs(current - previous) > WIDTH_CHANGE_PX;
}

const STICKY_REVEAL_GAP = 8;
const STICKY_REVEAL_BOTTOM_PAD = 24;

export function stickyRevealDelta(input: {
  nodeTop: number;
  headerBottom: number;
  scrollerBottom: number;
  gap?: number;
}): number | null {
  const floor = input.headerBottom + (input.gap ?? STICKY_REVEAL_GAP);
  if (
    input.nodeTop >= floor &&
    input.nodeTop <= input.scrollerBottom - STICKY_REVEAL_BOTTOM_PAD
  ) {
    return null;
  }
  return input.nodeTop - floor;
}

export function applyStickyReveal(
  node: { getBoundingClientRect: () => { top: number } },
  scroller: {
    getBoundingClientRect: () => { top: number; bottom: number };
    scrollTop: number;
  },
  header: { getBoundingClientRect: () => { bottom: number } } | null,
): boolean {
  const nodeBox = node.getBoundingClientRect();
  const scrollerBox = scroller.getBoundingClientRect();
  const delta = stickyRevealDelta({
    nodeTop: nodeBox.top,
    headerBottom: header
      ? header.getBoundingClientRect().bottom
      : scrollerBox.top,
    scrollerBottom: scrollerBox.bottom,
  });
  if (delta == null) return false;
  scroller.scrollTop += delta;
  return true;
}

export function applyShellMetrics(
  root: {
    style: {
      setProperty: (name: string, value: string) => void;
      removeProperty: (name: string) => void;
    };
    dataset: { composerKeyboard?: string };
  },
  metrics: ShellMetrics,
) {
  if (metrics.keyboardOpen && metrics.height != null) {
    root.dataset.composerKeyboard = "open";
    root.style.setProperty("--app-height", metrics.height + "px");
    root.style.setProperty("--app-offset-top", metrics.offsetTop + "px");
    return;
  }
  delete root.dataset.composerKeyboard;
  root.style.removeProperty("--app-height");
  root.style.setProperty("--app-offset-top", "0px");
}
