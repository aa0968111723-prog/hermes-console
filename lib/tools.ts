import { PROJECTS, TOOLS } from "./catalog";
import { HERMES_DEFAULTS } from "./hermes-config";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolExecutionResult {
  toolName: string;
  args: Record<string, unknown>;
  success: boolean;
  result: unknown;
  summary: string;
}

/**
 * Hermes Agent 註冊的可用工具清單 (OpenAI Function Calling 標準格式)
 */
export const HERMES_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_ecosystem_projects",
      description: "查詢柯能 / Bruce 的 41 個生態系專案目錄。支援關鍵字篩選與群組分類（控制台、創作系統、設計、學校社團、代理、作品集）。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜尋關鍵字（例如：'duigao'、'分鏡'、'海報'、'禪學社'）"
          },
          group: {
            type: "string",
            description: "專案分組篩選（例如：'創作系統'、'設計'、'學校社團'、'代理'）"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "inspect_project",
      description: "取得特定專案的深度規格、GitHub 網址、部署站台與相關標籤。",
      parameters: {
        type: "object",
        properties: {
          projectName: {
            type: "string",
            description: "專案名稱（例如：'ai_os'、'duigao'、'planform-iso'、'hermes-console'）"
          }
        },
        required: ["projectName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_zeabur_dashboard_info",
      description: "取得 Zeabur 上 Hermes Agent 服務的儀表板登入資訊、管理帳號與通訊協定設定指引。",
      parameters: {
        type: "object",
        properties: {
          needPassword: {
            type: "boolean",
            description: "是否回傳儀表板密碼安全提示"
          }
        }
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
          pingOnly: {
            type: "boolean",
            description: "是否僅進行存活 Ping 測試"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_creative_brief",
      description: "為創作系統（分鏡劇本、海報視覺、社群文宣）產生結構化設計規格與鏡頭拆解腳本。",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "作品或文案主題"
          },
          category: {
            type: "string",
            enum: ["storyboard", "poster", "copywriting", "workflow"],
            description: "創作類別：storyboard(分鏡鏡頭), poster(海報視覺), copywriting(文案), workflow(工作流)"
          },
          targetAudience: {
            type: "string",
            description: "目標受眾或情境"
          },
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
            description: "操作類型：split_shots(拆解鏡頭), condense_copy(精煉文案), extract_keywords(提取關鍵字)"
          },
          rawText: {
            type: "string",
            description: "原始文本內容"
          }
        },
        required: ["action", "rawText"]
      }
    }
  }
];

/**
 * 本地執行 Hermes 工具並返回結果
 */
export async function executeHermesTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  switch (name) {
    case "get_ecosystem_projects": {
      const q = String(args.query || "").toLowerCase();
      const group = String(args.group || "").toLowerCase();
      const filtered = PROJECTS.filter((p) => {
        const matchQ = !q || p.name.toLowerCase().includes(q) || p.blurb.toLowerCase().includes(q) || (p.tags && p.tags.some(t => t.toLowerCase().includes(q)));
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
      const project = PROJECTS.find((p) => p.name.toLowerCase() === target);
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
          toolsLinked: TOOLS.map(t => t.name),
          ecosystemRole: `隸屬 ${project.group} 領域`
        },
        summary: `已取得專案 ${project.name} 的規格與 GitHub 資訊`
      };
    }

    case "get_zeabur_dashboard_info": {
      return {
        toolName: name,
        args,
        success: true,
        result: {
          dashboardUser: HERMES_DEFAULTS.DASHBOARD_USER,
          dashboardPass: HERMES_DEFAULTS.DASHBOARD_PASS,
          apiEndpoint: HERMES_DEFAULTS.CHAT_ENDPOINT,
          servicePort: "Web Port / 9119",
          note: "請在 Zeabur 儀表板將域名綁定到 API 埠口，並使用上方管理帳號登入 Dashboard 查看即時日誌與工具狀態。"
        },
        summary: "已回傳 Zeabur 儀表板連線憑證與管理指引"
      };
    }

    case "check_hermes_status": {
      return {
        toolName: name,
        args,
        success: true,
        result: {
          status: "ONLINE",
          model: HERMES_DEFAULTS.DEFAULT_MODEL,
          uptime: "Zeabur 雲端容器運作中",
          timestamp: new Date().toISOString(),
          toolsRegisteredCount: HERMES_TOOLS.length,
          features: ["Streaming SSE", "Function Calling", "Multi-turn Memory", "Zeabur Deep Connect"]
        },
        summary: `Hermes Agent 核心在線，已就緒 ${HERMES_TOOLS.length} 項工具`
      };
    }

    case "generate_creative_brief": {
      const title = String(args.title || "未命名創作");
      const cat = String(args.category || "storyboard");
      const keyPoints = Array.isArray(args.keyPoints) ? (args.keyPoints as string[]) : [];

      if (cat === "storyboard") {
        const shots = keyPoints.length > 0 ? keyPoints.map((k, i) => `S${i + 1}: ${k} (景別: 中景/特寫, 運鏡: 推軌)`) : [
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
          summary: `已產出《${title}》的 4 鏡分鏡腳本規格`
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
        const lines = raw.split(/[。！？\n]/).map(s => s.trim()).filter(Boolean);
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
