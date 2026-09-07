import type { ResearchBundle, ResearchSourceRecord } from "../../contracts";
import { mapTamkangTools, tamkangStatus } from "../tamkang";

export type SourceRecord = ResearchSourceRecord;
export const FRESHMAN_GATE = /淡江|新生|淡水/;
export const EDU_PSYCH_GATE =
  /教心所|教育心理|學習動機|IRB|諮商|文獻|評量倫理|去識別|人審|知情同意|研究倫理/;
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
export const EDU_PSYCH_QUERIES = [
  "教育心理學",
  "學習動機",
  "認知發展",
  "評量倫理",
  "諮商倫理",
  "研究倫理",
  "IRB 人體研究審查",
  "知情同意",
  "去識別",
  "文獻回顧",
  "研究方法",
];
export function classifyResearchTools(
  tools: Array<{ name: string; description?: string }>,
) {
  return mapTamkangTools(tools); // Name matches are hints, not verified execution capabilities.
}
function sourceStub(
  id: string,
  url: string,
  title: string,
  usedFor: string,
): SourceRecord {
  return {
    id,
    url,
    provider: "source_directory",
    title,
    excerpt: "",
    retrievedAt: null,
    publishedAt: null,
    official: true,
    confidence: null,
    usedFor,
    verification: "not_fetched",
  };
}
export function officialWebSources(): SourceRecord[] {
  return [
    sourceStub(
      "tku-official",
      "https://www.tku.edu.tw/",
      "淡江大學官方網站（待查詢入口）",
      "research_entry",
    ),
  ];
}
export function officialEduPsychSources(): SourceRecord[] {
  return [
    sourceStub(
      "tku-edpsy",
      "https://www.edpsy.tku.edu.tw/",
      "淡江大學教育心理與諮商研究所（待查詢入口）",
      "research_entry",
    ),
    sourceStub(
      "tw-human-research-act",
      "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=L0020176",
      "人體研究法（全國法規資料庫，待查詢）",
      "research_ethics_entry",
    ),
  ];
}
function uniqueSources(records: SourceRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
}
export function researchBundle(input: {
  prompt: string;
  mcpReachable?: boolean;
  tools?: Array<{ name: string; description?: string }>;
}): ResearchBundle {
  // This function constructs a plan only. Caller booleans must never attest a live service.
  const freshman = FRESHMAN_GATE.test(input.prompt);
  const eduPsych = EDU_PSYCH_GATE.test(input.prompt);
  const queries = [
    ...(freshman ? FRESHMAN_QUERIES : []),
    ...(eduPsych ? EDU_PSYCH_QUERIES : []),
  ];
  const sourceDirectory = uniqueSources([
    ...(freshman || eduPsych ? officialWebSources() : []),
    ...(eduPsych ? officialEduPsychSources() : []),
  ]);
  return {
    queries,
    tamkang: tamkangStatus(),
    fallback: null,
    suggestedFallback: "ask_hermes_authorized_web_tool",
    executed: false,
    message:
      "尚未執行研究；需由 Hermes 呼叫已授權來源，再保存實際結果與查詢時間。",
    mapping: classifyResearchTools(input.tools || []),
    sources: [],
    claims: [],
    sourceDirectory,
  };
}
export function formatResearchPlanForInstructions(bundle: ResearchBundle) {
  const queries = bundle.queries.length
    ? bundle.queries.join("、")
    : "（目前沒有對應的建議查詢詞）";
  const sources =
    bundle.sourceDirectory
      .map(
        (item) => item.title + " " + item.url + "（" + item.verification + "）",
      )
      .join("；") || "（尚無待查官方入口）";
  return [
    "研究計畫（executed=" +
      String(bundle.executed) +
      "，不是已完成的文獻檢索）：",
    "建議查詢詞：" + queries,
    "待查來源目錄：" + sources,
    bundle.message,
  ].join("\n");
}
