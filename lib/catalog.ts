export type Project = {
  name: string;
  group: string;
  blurb: string;
  url: string;
  live?: string;
  tags?: string[];
};

export const TOOLS = [
  { name: "GitHub", status: "Verified", desc: "儲存庫與提交狀態查詢（公開/認證）", href: "https://github.com/aa0968111723-prog" },
  { name: "Zeabur Hermes Brain", status: "Partial", desc: "雲端主腦與本地高擬真雙引擎自動備援", href: "#zeabur" },
  { name: "Vercel", status: "Connected", desc: "前端與即時站台部署", href: "https://vercel.com" },
  { name: "Canva", status: "Needs Authorization", desc: "視覺排版與設計橋接（支援 PKCE 授權與沙盒模式）", href: "https://www.canva.com" },
  { name: "Google Drive", status: "Unconfigured", desc: "素材與劇本雲端儲存（待授權綁定）", href: "https://drive.google.com" },
  { name: "Ecosystem Catalog", status: "Verified", desc: "41 個生態系專案即時檢索索引", href: "#catalog" },
  { name: "Voice & Audio", status: "Partial", desc: "語音合成與旁白管線（本地合成備妥）", href: "#voice" }
];

export const PROJECTS: Project[] = [
  // 控制台
  { name: "hermes-console", group: "控制台", blurb: "這個前端 — Hermes Agent 控制中樞與對話介面", url: "https://github.com/aa0968111723-prog/hermes-console", tags: ["Next.js", "Console", "Zeabur"] },
  { name: "hermes-ecosystem", group: "控制台", blurb: "41 個專案總目錄與架構地圖", url: "https://github.com/aa0968111723-prog/hermes-ecosystem", tags: ["Architecture", "Index"] },
  
  // 創作系統
  { name: "ai_os", group: "創作系統", blurb: "全模態 AI 導演作業系統核心", url: "https://github.com/aa0968111723-prog/ai_os", live: "https://ai-os-ten.vercel.app", tags: ["Director", "Engine"] },
  { name: "healing-studio", group: "創作系統", blurb: "多模態 AI 療癒創意工作室", url: "https://github.com/aa0968111723-prog/healing-studio", tags: ["Multimodal", "Studio"] },
  { name: "CUTOS", group: "創作系統", blurb: "對話式影片剪輯與鏡頭排程", url: "https://github.com/aa0968111723-prog/CUTOS", tags: ["Video", "Editing"] },
  { name: "FrameLab", group: "創作系統", blurb: "逐幀動畫與動態分鏡工作站", url: "https://github.com/aa0968111723-prog/FrameLab", tags: ["Animation", "Storyboard"] },
  { name: "lunar-crystal-falcon-granite", group: "創作系統", blurb: "逐幀動畫核心實驗室", url: "https://github.com/aa0968111723-prog/lunar-crystal-falcon-granite", tags: ["Animation"] },

  // 設計與視覺
  { name: "duigao", group: "設計", blurb: "手機優先圖片／影片對稿協作工具", url: "https://github.com/aa0968111723-prog/duigao", tags: ["Review", "Mobile", "Supabase"] },
  { name: "planform-iso", group: "設計", blurb: "3D 等角場佈與空間佈置編輯器", url: "https://github.com/aa0968111723-prog/planform-iso", tags: ["Three.js", "Isometric", "3D"] },
  { name: "folio-design-editor", group: "設計", blurb: "海報 / 社群 / 簡報自動化排版編輯器", url: "https://github.com/aa0968111723-prog/folio-design-editor", tags: ["Editor", "Layout"] },
  { name: "canva2", group: "設計", blurb: "Canva 指令自動化操作層", url: "https://github.com/aa0968111723-prog/canva2", tags: ["Automation", "Design"] },
  { name: "poster-vision-ai", group: "設計", blurb: "海報視覺檢測與構圖診斷 AI", url: "https://github.com/aa0968111723-prog/poster-vision-ai", tags: ["Vision", "Quality"] },

  // 學校與社團
  { name: "tku-zen-agent", group: "學校社團", blurb: "淡江大學領袖禪學社 AI 智能代理", url: "https://github.com/aa0968111723-prog/tku-zen-agent", tags: ["Zen", "Club", "Agent"] },
  { name: "tku-tamsui-drama-world", group: "學校社團", blurb: "淡江·淡水劇本文創世界", url: "https://github.com/aa0968111723-prog/tku-tamsui-drama-world", tags: ["Script", "Drama"] },
  { name: "tku-zen-ai", group: "學校社團", blurb: "禪學社 AI 專屬互動前端", url: "https://github.com/aa0968111723-prog/tku-zen-ai", tags: ["Frontend", "Club"] },

  // 代理與工作流
  { name: "claude-workbench", group: "代理", blurb: "Claude 協作工作台與任務分派中樞", url: "https://github.com/aa0968111723-prog/claude-workbench", tags: ["Claude", "Workbench"] },
  { name: "aios-public-agent-fuel", group: "代理", blurb: "公開 Agent 提示詞與素材資料庫", url: "https://github.com/aa0968111723-prog/aios-public-agent-fuel", tags: ["Prompts", "Fuel"] },
  { name: "aios-personal-phone-agent", group: "代理", blurb: "Android 手機代理與硬體控制層", url: "https://github.com/aa0968111723-prog/aios-personal-phone-agent", tags: ["Mobile", "Android"] },
  { name: "river-spruce-bay-fair", group: "代理", blurb: "多模態推理與 Grok 提示詞實驗室", url: "https://github.com/aa0968111723-prog/river-spruce-bay-fair", tags: ["Grok", "Prompts"] },

  // 作品集
  { name: "portfolio", group: "作品集", blurb: "柯能個人作品集站台", url: "https://github.com/aa0968111723-prog/portfolio", tags: ["Portfolio", "Bio"] },
  { name: "ai-director-portfolio-site", group: "作品集", blurb: "AI 導演與影視作品專屬展示庫", url: "https://github.com/aa0968111723-prog/ai-director-portfolio-site", tags: ["Showcase", "Film"] }
];
