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
}

// 預設注入之淡江領袖禪學社真實校園記憶庫
const INITIAL_MEMORIES: MemoryItem[] = [
  {
    id: "mem_tku_geo_01",
    type: "campus_context",
    project: "tku-zen-agent",
    title: "淡江克難坡與體力考驗",
    content: "克難坡共 132 階，是每位淡江人從捷運淡水站或老街步行上學的必經洗禮。新生剛開學時普遍感到體力耗竭與多雨潮濕的不適應，渴望下課後有能坐下來靜心歇息的空間。",
    evidenceType: "verified_fact",
    tags: ["淡江地標", "克難坡", "生活作息", "體力疲勞"],
    createdAt: Date.now() - 86400000 * 10
  },
  {
    id: "mem_tku_geo_02",
    type: "campus_context",
    project: "tku-zen-agent",
    title: "福園、黑天鵝與宮燈古風氛圍",
    content: "福園池畔的黑天鵝是淡江的精神象徵；旁邊宮燈大道與宮燈教室則是全台罕見的仿古建築群，自帶幽靜、文藝與沉澱氣質，非常契合禪茶與放鬆交流活動。",
    evidenceType: "verified_fact",
    tags: ["淡江地標", "福園", "宮燈教室", "黑天鵝", "茶會氛圍"],
    createdAt: Date.now() - 86400000 * 9
  },
  {
    id: "mem_tku_freshman_01",
    type: "audience",
    project: "tku-zen-agent",
    title: "大一新生迎新防衛心理與孤獨感",
    content: "新生一方面極度渴望拓展社交圈、認識聊得來的朋友；另一方面極度排斥說教、強迫推銷或帶有長輩感/宗教沉重感的活動。茶會應強調『零社交壓力』、『純粹放鬆品茶』與『大一選課生活經驗分享』。",
    evidenceType: "campus_observation",
    tags: ["大一新生", "社交焦慮", "破冰體驗", "心理痛點"],
    createdAt: Date.now() - 86400000 * 8
  },
  {
    id: "mem_zen_usp_01",
    type: "insight",
    project: "tku-zen-agent",
    title: "領袖禪學社核心獨特價值 (USP)",
    content: "領袖禪學社提倡『實用專注放鬆禪』，不談深奧玄學，專注於用科學的腹式呼吸與專注法，幫助大學生在期中考試、競賽與繁重課業中瞬間清空大腦雜訊，重拾清晰思維。",
    evidenceType: "verified_fact",
    tags: ["社團核心", "專注放鬆", "科學禪", "青年定位"],
    createdAt: Date.now() - 86400000 * 7
  },
  {
    id: "mem_visual_guide_01",
    type: "guideline",
    project: "tku-zen-agent",
    title: "網宣視覺調性規範",
    content: "拒絕任何陳腐黃底黑字長輩圖。視覺採用『淡水暮色』或『抹茶茶香微光』清新低飽和色調；排版具備呼吸感與手作溫度；三色光元素僅以圓形手作小道具自然融入，不喧賓奪主。",
    evidenceType: "verified_fact",
    tags: ["視覺設計", "色彩規範", "三色光", "拒絕長輩圖"],
    createdAt: Date.now() - 86400000 * 6
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
      for (const term of queryTerms) {
        if (text.includes(term)) {
          score += 10;
        }
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
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now()
  };
  memoryStore.unshift(fullItem);
  return fullItem;
}
