export const MOBILE_CREATIVE_PANES = [
  { id: "brief", label: "方向" },
  { id: "design", label: "設計" },
  { id: "copy", label: "文案" },
  { id: "audience", label: "受眾" },
] as const;

export type MobileCreativePane = (typeof MOBILE_CREATIVE_PANES)[number]["id"];

export const MOBILE_BREAKPOINT_PX = 760;
