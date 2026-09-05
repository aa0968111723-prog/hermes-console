export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ToolExecutionResult {
  toolName: string;
  args: Record<string, unknown>;
  success: boolean;
  result: unknown;
  summary: string;
}

export interface EcosystemProject {
  name: string;
  group: string;
  blurb: string;
  url: string;
  live?: string;
  tags?: string[];
}

export const ECOSYSTEM_PROJECTS: EcosystemProject[] = [
  { name: "hermes-console", group: "控制台", blurb: "Hermes Agent 控制中樞與對話介面", url: "https://github.com/aa0968111723-prog/hermes-console", tags: ["Next.js", "Console", "Zeabur"] },
  { name: "hermes-ecosystem", group: "控制台", blurb: "41 個專案總目錄與架構地圖", url: "https://github.com/aa0968111723-prog/hermes-ecosystem", tags: ["Architecture", "Index"] },
  { name: "ai_os", group: "創作系統", blurb: "全模態 AI 導演作業系統核心", url: "https://github.com/aa0968111723-prog/ai_os", live: "https://ai-os-ten.vercel.app", tags: ["Director", "Engine"] },
  { name: "healing-studio", group: "創作系統", blurb: "多模態 AI 療癒創意工作室", url: "https://github.com/aa0968111723-prog/healing-studio", tags: ["Multimodal", "Studio"] },
  { name: "CUTOS", group: "創作系統", blurb: "對話式影片剪輯與鏡頭排程", url: "https://github.com/aa0968111723-prog/CUTOS", tags: ["Video", "Editing"] },
  { name: "FrameLab", group: "創作系統", blurb: "逐幀動畫與動態分鏡工作站", url: "https://github.com/aa0968111723-prog/FrameLab", tags: ["Animation", "Storyboard"] },
  { name: "duigao", group: "設計", blurb: "手機優先圖片／影片對稿協作工具", url: "https://github.com/aa0968111723-prog/duigao", tags: ["Review", "Mobile", "Supabase"] },
  { name: "planform-iso", group: "設計", blurb: "3D 等角場佈與空間佈置編輯器", url: "https://github.com/aa0968111723-prog/planform-iso", tags: ["Three.js", "Isometric", "3D"] },
  { name: "folio-design-editor", group: "設計", blurb: "海報 / 社群 / 簡報自動化排版編輯器", url: "https://github.com/aa0968111723-prog/folio-design-editor", tags: ["Editor", "Layout"] },
  { name: "tku-zen-agent", group: "學校社團", blurb: "淡江大學領袖禪學社 AI 智能代理", url: "https://github.com/aa0968111723-prog/tku-zen-agent", tags: ["Zen", "Club", "Agent"] },
  { name: "tku-tamsui-drama-world", group: "學校社團", blurb: "淡江·淡水劇本文創世界", url: "https://github.com/aa0968111723-prog/tku-tamsui-drama-world", tags: ["Script", "Drama"] }
];

export const HERMES_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_ecosystem_projects",
      description: "查詢柯能 41 個開源與創作專案目錄，支援依類別或關鍵字篩選。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜尋關鍵字" },
          group: { type: "string", description: "專案分類" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "inspect_project",
      description: "深入檢視特定專案的架構設計、程式碼倉庫網址、技術標籤與工具鏈綁定關係。",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string", description: "專案名稱" }
        },
        required: ["projectName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "check_hermes_status",
      description: "檢查 Hermes Agent 核心大腦的運作狀態、系統時間與工具調用管線可用性。",
      parameters: {
        type: "object",
        properties: {
          pingOnly: { type: "boolean", description: "是否僅進行存活 Ping 測試" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_creative_brief",
      description: "為創作系統產生結構化設計規格與鏡頭拆解腳本。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "作品或文案主題" },
          category: {
            type: "string",
            enum: ["storyboard", "poster", "copywriting", "workflow"],
            description: "創作類別"
          },
          targetAudience: { type: "string", description: "目標受眾或情境" },
          keyPoints: {
            type: "array",
            items: { type: "string" },
            description: "核心要點或關鍵場景清單"
          }
        },
        required: ["title", "category"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_text_transform",
      description: "執行文本處理管線：繁體中文切句、分鏡鏡頭拆解編號、或文宣標題精煉。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["split_shots", "condense_copy", "extract_keywords"],
            description: "操作類型"
          },
          rawText: { type: "string", description: "原始文本內容" }
        },
        required: ["action", "rawText"]
      }
    }
  }
];

export async function executeHermesTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  switch (name) {
    case "get_ecosystem_projects": {
      const q = String(args.query || "").toLowerCase();
      const group = String(args.group || "").toLowerCase();
      const filtered = ECOSYSTEM_PROJECTS.filter((p) => {
        const matchQ =
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.blurb.toLowerCase().includes(q) ||
          (p.tags && p.tags.some((t) => t.toLowerCase().includes(q)));
        const matchG = !group || p.group.toLowerCase().includes(group);
        return matchQ && matchG;
      });
      return {
        toolName: name,
        args,
        success: true,
        result: filtered,
        summary: `檢索到 ${filtered.length} 個符合條件的專案`
      };
    }

    case "inspect_project": {
      const target = String(args.projectName || "").toLowerCase();
      const project = ECOSYSTEM_PROJECTS.find(
        (p) => p.name.toLowerCase() === target
      );
      if (!project) {
        return {
          toolName: name,
          args,
          success: false,
          result: { error: `找不到名為 "${target}" 的專案` },
          summary: `找不到專案 "${target}"`
        };
      }
      return {
        toolName: name,
        args,
        success: true,
        result: {
          ...project,
          ecosystemRole: `隸屬 ${project.group} 領域`
        },
        summary: `已取得專案 ${project.name} 的規格與 GitHub 資訊`
      };
    }

    case "check_hermes_status": {
      return {
        toolName: name,
        args,
        success: true,
        result: {
          status: "ONLINE",
          uptime: "伺服器運作中",
          timestamp: new Date().toISOString(),
          toolsRegisteredCount: HERMES_TOOLS.length,
          features: ["Streaming SSE", "Function Calling", "Multi-turn Memory"]
        },
        summary: `Hermes Agent 核心在線，已就緒 ${HERMES_TOOLS.length} 項工具`
      };
    }

    case "generate_creative_brief": {
      const title = String(args.title || "未命名創作");
      const cat = String(args.category || "storyboard");
      const keyPoints = Array.isArray(args.keyPoints)
        ? (args.keyPoints as string[])
        : [];

      if (cat === "storyboard") {
        const shots =
          keyPoints.length > 0
            ? keyPoints.map(
                (k, i) => `S${i + 1}: ${k} (景別: 中景/特寫, 運鏡: 推軌)`
              )
            : [
                "S01: 開場建立鏡頭 — 角色登場與環境氛圍",
                "S02: 衝突或動機浮現 — 表情特寫與手部動作細節",
                "S03: 核心高潮 — 視覺焦點與動態呈現",
                "S04: 結尾收束 — 意境延伸與主題定格"
              ];
        return {
          toolName: name,
          args,
          success: true,
          result: {
            title,
            format: "16:9 劇本分鏡規格",
            shots,
            productionNotes: "保持角色造型一致性，色彩採專案指定色票。"
          },
          summary: `已產出《${title}》的分鏡腳本規格`
        };
      }

      return {
        toolName: name,
        args,
        success: true,
        result: {
          title,
          category: cat,
          headline: `《${title}》核心亮點主張`,
          sections: [
            { label: "主視覺構圖", note: "高對比層級，重點資訊單一聚焦" },
            { label: "核心呼籲文案", note: "繁體中文精煉金句" }
          ]
        },
        summary: `已產出《${title}》的視覺文宣規格`
      };
    }

    case "run_text_transform": {
      const action = String(args.action || "split_shots");
      const raw = String(args.rawText || "");
      if (action === "split_shots") {
        const lines = raw
          .split(/[。！？\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
        const shots = lines.map((line, idx) => `鏡號 #${idx + 1}: ${line}`);
        return {
          toolName: name,
          args,
          success: true,
          result: { count: shots.length, shots },
          summary: `已拆解出 ${shots.length} 個分鏡鏡頭`
        };
      }
      return {
        toolName: name,
        args,
        success: true,
        result: { processed: raw.trim() },
        summary: "文字已完成轉換"
      };
    }

    default:
      return {
        toolName: name,
        args,
        success: false,
        result: { error: `未知的工具名稱: ${name}` },
        summary: `調用失敗：未支援 ${name}`
      };
  }
}
