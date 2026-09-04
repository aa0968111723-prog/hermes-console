export type Project = {
  name: string;
  group: string;
  blurb: string;
  url: string;
  live?: string;
};

export const TOOLS = [
  { name: "GitHub", status: "已連", href: "https://github.com/aa0968111723-prog" },
  { name: "Vercel", status: "已連", href: "https://vercel.com" },
  { name: "Canva", status: "已連", href: "https://www.canva.com" },
  { name: "Google Drive", status: "已連", href: "https://drive.google.com" },
  { name: "Voice", status: "已連", href: "#" },
  { name: "Zeabur", status: "待接 MCP", href: "https://zeabur.com" },
  { name: "Hermes Dashboard", status: "port 9119", href: "#dashboard" }
];

export const PROJECTS: Project[] = [
  { name: "hermes-console", group: "控制台", blurb: "這個前端", url: "https://github.com/aa0968111723-prog/hermes-console" },
  { name: "hermes-ecosystem", group: "控制台", blurb: "41 個專案總目錄", url: "https://github.com/aa0968111723-prog/hermes-ecosystem" },
  { name: "ai_os", group: "創作系統", blurb: "創作系統", url: "https://github.com/aa0968111723-prog/ai_os", live: "https://ai-os-ten.vercel.app" },
  { name: "healing-studio", group: "創作系統", blurb: "多模態 AI 工作室", url: "https://github.com/aa0968111723-prog/healing-studio" },
  { name: "CUTOS", group: "創作系統", blurb: "對話式影片編輯", url: "https://github.com/aa0968111723-prog/CUTOS" },
  { name: "FrameLab", group: "創作系統", blurb: "逐幀動畫工作站", url: "https://github.com/aa0968111723-prog/FrameLab" },
  { name: "folio-design-editor", group: "設計", blurb: "海報 / 社群 / 簡報編輯器", url: "https://github.com/aa0968111723-prog/folio-design-editor" },
  { name: "canva2", group: "設計", blurb: "Canva 指令層", url: "https://github.com/aa0968111723-prog/canva2" },
  { name: "duigao", group: "設計", blurb: "對稿·文宣比對", url: "https://github.com/aa0968111723-prog/duigao" },
  { name: "poster-vision-ai", group: "設計", blurb: "海報視覺檢測", url: "https://github.com/aa0968111723-prog/poster-vision-ai" },
  { name: "planform-iso", group: "設計", blurb: "3D 等角場佈", url: "https://github.com/aa0968111723-prog/planform-iso" },
  { name: "tku-zen-agent", group: "學校社團", blurb: "淨江大學領袖禪學社 AI", url: "https://github.com/aa0968111723-prog/tku-zen-agent" },
  { name: "tku-tamsui-drama-world", group: "學校社團", blurb: "淡江·淡水戲劇世界", url: "https://github.com/aa0968111723-prog/tku-tamsui-drama-world" },
  { name: "tku-zen-ai", group: "學校社團", blurb: "禪學社 AI 前端", url: "https://github.com/aa0968111723-prog/tku-zen-ai" },
  { name: "portfolio", group: "作品集", blurb: "柯能作品集", url: "https://github.com/aa0968111723-prog/portfolio" },
  { name: "ai-director-portfolio-site", group: "作品集", blurb: "AI 導演作品集", url: "https://github.com/aa0968111723-prog/ai-director-portfolio-site" },
  { name: "aios-public-agent-fuel", group: "代理", blurb: "公開 Agent 素材", url: "https://github.com/aa0968111723-prog/aios-public-agent-fuel" },
  { name: "aios-personal-phone-agent", group: "代理", blurb: "Android 手機代理", url: "https://github.com/aa0968111723-prog/aios-personal-phone-agent" },
  { name: "claude-workbench", group: "代理", blurb: "Claude 工作台", url: "https://github.com/aa0968111723-prog/claude-workbench" }
];
