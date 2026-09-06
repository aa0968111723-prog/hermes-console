export const copy = {
  appTitle: "傻的創作小天地",
  greeting: "今天也要開心地創作呀！",
  greetingAck: "收到！正在想…",
  inputPlaceholder: "寫下你的想法或故事靈感吧...",
  projectLabel: "專案",
  orbLabels: { water: "水", light: "光", fire: "火", forest: "森" } as const,
  sendA11y: "送出靈感",
  orbA11y: (label: string) => `選擇${label}元素`,
  projects: ["傻的創作小天地", "寶可夢風短篇", "淡江禪學腳本"],
} as const;
