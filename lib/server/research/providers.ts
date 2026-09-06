import { mapTamkangTools, tamkangStatus } from "../tamkang";

export interface SourceRecord {
  id: string;
  url: string;
  provider: string;
  title: string;
  excerpt: string;
  retrievedAt: string | null;
  publishedAt: string | null;
  official: boolean;
  confidence: number | null;
  usedFor: string;
  verification: "not_fetched";
}
export const FRESHMAN_QUERIES = [
  "新生",
  "校園生活",
  "住宿",
  "宿舍",
  "租屋",
  "交通",
  "淡水捷運",
  "克難坡",
  "校園地點",
  "新生活動",
  "社團",
  "學生組織",
  "附近飲食",
  "打工",
  "學習",
  "休閒",
];
export function classifyResearchTools(
  tools: Array<{ name: string; description?: string }>,
) {
  return mapTamkangTools(tools); // Name matches are hints, not verified execution capabilities.
}
export function officialWebSources(): SourceRecord[] {
  return [
    {
      id: "tku-official",
      url: "https://www.tku.edu.tw/",
      provider: "source_directory",
      title: "淡江大學官方網站（待查詢入口）",
      excerpt: "",
      retrievedAt: null,
      publishedAt: null,
      official: true,
      confidence: null,
      usedFor: "research_entry",
      verification: "not_fetched",
    },
  ];
}
export function researchBundle(input: {
  prompt: string;
  mcpReachable?: boolean;
  tools?: Array<{ name: string; description?: string }>;
}) {
  // This function constructs a plan only. Caller booleans must never attest a live service.
  const tku = tamkangStatus();
  return {
    queries: /淡江|新生|淡水/.test(input.prompt) ? FRESHMAN_QUERIES : [],
    tamkang: tku,
    fallback: null,
    suggestedFallback: "ask_hermes_authorized_web_tool",
    executed: false,
    message:
      "尚未執行研究；需由 Hermes 呼叫已授權來源，再保存實際結果與查詢時間。",
    mapping: classifyResearchTools([]),
    sources: [],
    claims: [],
    sourceDirectory: /淡江|淡水/.test(input.prompt) ? officialWebSources() : [],
  };
}
