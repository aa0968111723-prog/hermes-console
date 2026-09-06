/**
 * Hermes 大腦記憶中心 (Brain & Project Memory Center)
 * 儲存全域生態、淡江大學校園脈絡、大一新生受眾洞察與專案長期記憶
 */

export type MemoryEvidenceType = "verified_fact" | "campus_observation" | "creative_hypothesis";

export interface MemoryItem {
  id: string;
  type: "fact" | "insight" | "campus_context" | "audience" | "guideline";
  project: string;
  title: string;
  content: string;
  evidenceType: MemoryEvidenceType;
  tags: string[];
  createdAt: number;
  sourceLayer?: "console_seed" | "hermes_memory" | "session_history" | "project_context" | "audience_context";
}

// 預設注入之淡江領袖禪學社真實校園記憶庫
const INITIAL_MEMORIES: MemoryItem[] = [
  {
    id: "mem_tku_geo_01",
    type: "campus_context",
    project: "tku-zen-agent",
    title: "淡江克難坡與體力考驗",
    content: "克難坡共 132 階，是每位淡江人從捷運淡水站或老街步行上學的必經洗禮。新生剛開學時普遍感到體力耗竭與多雨潮濕的不適應，渴望下課後有能坐下來靜心歇息的空間。",
    evidenceType: "campus_observation",
    tags: ["淡江地標", "克難坡", "生活作息", "體力疲勞"],
    createdAt: Date.now() - 86400000 * 10,
    sourceLayer: "console_seed"
  },
  {
    id: "mem_tku_geo_02",
    type: "campus_context",
    project: "tku-zen-agent",
    title: "福園、黑天鵝與宮燈古風氛圍",
    content: "福園池畔的黑天鵝是淡江的精神象徵；旁邊宮燈大道與宮燈教室則是全台罕見的仿古建築群，自帶幽靜、文藝與沉澱氣質，非常契合禪茶與放鬆交流活動。",
    evidenceType: "campus_observation",
    tags: ["淡江地標", "福園", "宮燈教室", "黑天鵝", "茶會氛圍"],
    createdAt: Date.now() - 86400000 * 9,
    sourceLayer: "console_seed"
  },
  {
    id: "mem_tku_freshman_01",
    type: "audience",
    project: "tku-zen-agent",
    title: "大一新生迎新防衛心理與孤獨感",
    content: "新生一方面極度渴望拓展社交圈、認識聊得來的朋友；另一方面極度排斥說教、強迫推銷或帶有長輩感/宗教沉重感的活動。茶會應強調『零社交壓力』、『純粹放鬆品茶』與『大一選課生活經驗分享』。",
    evidenceType: "creative_hypothesis",
    tags: ["大一新生", "社交焦慮", "破冰體驗", "心理痛點"],
    createdAt: Date.now() - 86400000 * 8,
    sourceLayer: "console_seed"
  },
  {
    id: "mem_zen_usp_01",
    type: "insight",
    project: "tku-zen-agent",
    title: "領袖禪學社核心獨特價值 (USP)",
    content: "領袖禪學社提倡『實用專注放鬆禪』，不談深奧玄學，專注於用科學的腹式呼吸與專注法，幫助大學生在期中考試、競賽與繁重課業中瞬間清空大腦雜訊，重拾清晰思維。",
    evidenceType: "creative_hypothesis",
    tags: ["社團核心", "專注放鬆", "科學禪", "青年定位"],
    createdAt: Date.now() - 86400000 * 7,
    sourceLayer: "console_seed"
  },
  {
    id: "mem_visual_guide_01",
    type: "guideline",
    project: "tku-zen-agent",
    title: "網宣視覺調性規範",
    content: "拒絕任何陳腐黃底黑字長輩圖。視覺採用『淡水暮色』或『抹茶茶香微光』清新低飽和色調；排版具備呼吸感與手作溫度；三色光元素僅以圓形手作小道具自然融入，不喧賓奪主。",
    evidenceType: "creative_hypothesis",
    tags: ["視覺設計", "色彩規範", "三色光", "拒絕長輩圖"],
    createdAt: Date.now() - 86400000 * 6,
    sourceLayer: "console_seed"
  },
  // 臺大專案在地校園脈絡記憶
  {
    id: "mem_ntu_geo_01",
    type: "campus_context",
    project: "ntu",
    title: "臺大椰林大道與腳踏車大亂流",
    content: "椰林大道兩側與總圖前的自行車大陣是臺大人的共同日常。新生開學第一個月最容易在浩瀚校園中迷路與尋找車位焦慮，需要貼地氣的生活導航與避雷指南。",
    evidenceType: "campus_observation",
    tags: ["臺大地標", "椰林大道", "腳踏車", "校園迷路", "新生日常"],
    createdAt: Date.now() - 86400000 * 10,
    sourceLayer: "console_seed"
  },
  {
    id: "mem_ntu_geo_02",
    type: "campus_context",
    project: "ntu",
    title: "小福廣場、醉月湖與活大交流區",
    content: "小福周邊是課間買點心與交朋友的高密度熱點；醉月湖與活大草坪則自帶悠閒沉思氣質，適合無壓力的戶外野餐茶席與跨領域話題交流。",
    evidenceType: "campus_observation",
    tags: ["臺大地標", "小福", "醉月湖", "活大", "野餐茶席"],
    createdAt: Date.now() - 86400000 * 9,
    sourceLayer: "console_seed"
  },
  {
    id: "mem_ntu_freshman_01",
    type: "audience",
    project: "ntu",
    title: "臺大新生同儕比較與抗壓痛點",
    content: "臺大學生普遍具有高度自我要求與同儕競爭焦慮，極度討厭空洞的套路與雞湯式文宣。文宣應強調實證效益、學霸思維降噪法與硬核通識選課不踩雷情報。",
    evidenceType: "creative_hypothesis",
    tags: ["臺大新生", "抗壓降噪", "通識選課", "同儕焦慮", "乾貨導向"],
    createdAt: Date.now() - 86400000 * 8,
    sourceLayer: "console_seed"
  },
  {
    id: "mem_ntu_usp_01",
    type: "insight",
    project: "ntu",
    title: "高效率思維整理與抗焦慮工作坊",
    content: "結合認知科學與深度專注放鬆禪，幫助臺大新生在大腦超載、期中修羅場與專題報告中瞬間回血，達到清晰聚焦的高效學習狀態。",
    evidenceType: "creative_hypothesis",
    tags: ["思維降噪", "高效學習", "專注放鬆", "科學實證"],
    createdAt: Date.now() - 86400000 * 7,
    sourceLayer: "console_seed"
  },
  // 通用大專脈絡記憶
  {
    id: "mem_gen_freshman_01",
    type: "audience",
    project: "personal",
    title: "大一轉銜期的生活適應與分組焦慮",
    content: "大一新鮮人初離家獨立生活，面對陌生的選課學分制、室友生活作息磨合與課堂分組壓力，渴望真誠接納的友善社群，排斥任何帶有說教或推銷感的活動。",
    evidenceType: "campus_observation",
    tags: ["大一適應", "生活轉銜", "分組焦慮", "友善社群"],
    createdAt: Date.now() - 86400000 * 10,
    sourceLayer: "console_seed"
  },
  {
    id: "mem_gen_usp_01",
    type: "insight",
    project: "personal",
    title: "大學生的無壓第三空間",
    content: "提供大學生在課業、打工與社團之間的療癒充電站。透過一杯好茶與 10 分鐘靜心，重啟日常精神飽滿度。",
    evidenceType: "creative_hypothesis",
    tags: ["第三空間", "放鬆充電", "品茶交流", "情緒調節"],
    createdAt: Date.now() - 86400000 * 9,
    sourceLayer: "console_seed"
  }
];

const memoryStore: MemoryItem[] = [...INITIAL_MEMORIES];

export function listMemories(project?: string): MemoryItem[] {
  if (!project || project === "all") {
    return memoryStore;
  }
  return memoryStore.filter((m) => m.project === project || m.project === "global");
}

export function searchMemories(query: string, project?: string): MemoryItem[] {
  const normalizedQuery = query.toLowerCase().trim();
  const candidates = listMemories(project);

  if (!normalizedQuery) {
    return candidates.slice(0, 10);
  }

  const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);

  return candidates
    .map((item) => {
      let score = 0;
      const text = `${item.title} ${item.content} ${item.tags.join(" ")}`.toLowerCase();

      // 1. 檢查記憶標籤是否出現在查詢中
      for (const tag of item.tags) {
        if (normalizedQuery.includes(tag.toLowerCase())) {
          score += 20;
        }
      }

      // 2. 核心校園與社團主題詞雙向比對
      const keywords = ["淡江", "禪學", "茶會", "新生", "大一", "克難坡", "福園", "宮燈", "選課", "放鬆", "視覺", "網宣"];
      for (const kw of keywords) {
        if (normalizedQuery.includes(kw) && text.includes(kw)) {
          score += 10;
        }
      }

      // 3. 一般詞彙比對
      for (const term of queryTerms) {
        if (text.includes(term)) {
          score += 10;
        }
      }

      // 4. 同專案基礎優先級
      if (item.project === project) {
        score += 2;
      }

      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

export function addMemory(item: Omit<MemoryItem, "id" | "createdAt">): MemoryItem {
  const fullItem: MemoryItem = {
    ...item,
    sourceLayer: item.sourceLayer || "project_context",
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now()
  };
  memoryStore.unshift(fullItem);
  return fullItem;
}

export interface MemoryLayerReport {
  id: "hermes_memory" | "hermes_session_history" | "console_project" | "audience_context" | "console_seed";
  label: string;
  available: boolean;
  source: "hermes" | "console";
  note: string;
  items: MemoryItem[];
}

export function getMemoryInventory(project?: string): {
  layers: MemoryLayerReport[];
  fabricatedHermesMemory: false;
} {
  const projectItems = listMemories(project);
  const seeds = projectItems.filter((item) => item.sourceLayer === "console_seed");
  const projectContext = projectItems.filter((item) => item.sourceLayer === "project_context");
  const audience = projectItems.filter((item) => item.type === "audience" || item.sourceLayer === "audience_context");
  return {
    fabricatedHermesMemory: false,
    layers: [
      {
        id: "hermes_memory",
        label: "Hermes Memory",
        available: false,
        source: "hermes",
        note: "This Hermes instance did not expose a memory provider. MEMORY.md is not fabricated.",
        items: [],
      },
      {
        id: "hermes_session_history",
        label: "Hermes Session History",
        available: false,
        source: "hermes",
        note: "Session search/history is unsupported until /api/sessions is available.",
        items: [],
      },
      {
        id: "console_project",
        label: "Console Project Context",
        available: true,
        source: "console",
        note: "Workspace-authored project notes. Not Hermes long-term memory.",
        items: projectContext,
      },
      {
        id: "audience_context",
        label: "Audience Context",
        available: audience.length > 0,
        source: "console",
        note: "Audience insights stored by Console, labeled separately from Hermes memory.",
        items: audience,
      },
      {
        id: "console_seed",
        label: "Console seed notes",
        available: seeds.length > 0,
        source: "console",
        note: "Built-in campus notes. Evidence type is not a verified Hermes memory file.",
        items: seeds,
      },
    ],
  };
}
