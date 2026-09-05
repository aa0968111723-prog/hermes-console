import { mapTamkangTools, tamkangStatus } from "../tamkang";
import { classifyFact } from "../audience";
import { resolveContextDomain, type AudienceDomain } from "../audience-twin/engine";

export interface SourceRecord {
  id: string;
  url: string;
  provider: string;
  title: string;
  excerpt: string;
  retrievedAt: string;
  publishedAt: string | null;
  official: boolean;
  confidence: number;
  usedFor: string;
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

export const NTU_FRESHMAN_QUERIES = [
  "新生",
  "校園生活",
  "椰林大道",
  "醉月湖",
  "公館",
  "通識",
  "社團",
  "住宿",
  "交通",
];

export const GENERAL_FRESHMAN_QUERIES = [
  "新生",
  "校園生活",
  "社團",
  "選課",
  "住宿",
  "交通",
];

export function queriesForDomain(domain: AudienceDomain): string[] {
  if (domain === "ntu") return NTU_FRESHMAN_QUERIES;
  if (domain === "general") return GENERAL_FRESHMAN_QUERIES;
  return FRESHMAN_QUERIES;
}

export function classifyResearchTools(
  tools: Array<{ name: string; description?: string }>,
) {
  const mapped = mapTamkangTools(tools);
  const byDescription: Record<string, string | null> = { ...mapped };
  for (const tool of tools) {
    const hay = tool.name + " " + (tool.description || "");
    if (/club|society|社團/.test(hay) && !byDescription.tku_clubs)
      byDescription.tku_clubs = tool.name;
    if (/transport|mrt|捷運|交通/.test(hay) && !byDescription.tku_transport)
      byDescription.tku_transport = tool.name;
  }
  return byDescription;
}

export function officialWebSources(): SourceRecord[] {
  const now = new Date().toISOString();
  return [
    {
      id: "tku-official",
      url: "https://www.tku.edu.tw/",
      provider: "TamkangOfficialWebProvider",
      title: "淡江大學",
      excerpt: "淡江大學位於新北市淡水區。",
      retrievedAt: now,
      publishedAt: null,
      official: true,
      confidence: 0.8,
      usedFor: "location",
    },
    {
      id: "ntu-official",
      url: "https://www.ntu.edu.tw/",
      provider: "NtuOfficialWebProvider",
      title: "國立臺灣大學",
      excerpt: "國立臺灣大學位於臺北市，校總區含椰林大道等公開校園地標。",
      retrievedAt: now,
      publishedAt: null,
      official: true,
      confidence: 0.8,
      usedFor: "location",
    },
  ];
}

export function researchBundle(input: {
  prompt: string;
  mcpReachable?: boolean;
  tools?: Array<{ name: string; description?: string }>;
}) {
  const domain = resolveContextDomain(input.prompt);
  const tku = tamkangStatus({
    reachable: input.mcpReachable,
    tools: input.tools,
  });
  const allSources = officialWebSources();
  const sources =
    domain === "ntu"
      ? allSources.filter((item) => item.id === "ntu-official")
      : domain === "general"
        ? allSources
        : allSources.filter((item) => item.id === "tku-official");
  const claims =
    domain === "ntu"
      ? [
          { claim: "國立臺灣大學位於臺北市。", sourceId: "https://www.ntu.edu.tw/", category: "location" },
          { claim: "大一新生剛到公館會期待認識新朋友。", sourceId: null, category: "social" },
          { claim: "All students love this event", sourceId: "https://seo.example/fake", category: "hype" },
        ]
      : domain === "general"
        ? [
            { claim: "大專迎新時程以各校教務行事曆為準。", sourceId: null, category: "calendar" },
            { claim: "大一新生通常希望低門檻認識朋友。", sourceId: null, category: "social" },
            { claim: "All students love this event", sourceId: "https://seo.example/fake", category: "hype" },
          ]
        : [
            { claim: "淡江大學位於淡水。", sourceId: "https://www.tku.edu.tw/", category: "location" },
            { claim: "大一新生剛到淡水會期待認識新朋友。", sourceId: null, category: "social" },
            { claim: "All students love this event", sourceId: "https://seo.example/fake", category: "hype" },
          ];
  const labeled = claims.map((item) => ({
    ...item,
    kind:
      item.category === "hype"
        ? "hypothesis" as const
        : classifyFact(item.claim, item.sourceId),
  }));
  return {
    domain,
    queries: queriesForDomain(domain),
    tamkang: tku,
    fallback:
      tku.state === "failed" || tku.state === "unconfigured"
        ? "web_research"
        : null,
    message:
      tku.state === "failed"
        ? "Tamkang MCP unavailable，using web research。"
        : tku.detail,
    mapping: classifyResearchTools(input.tools || []),
    sources,
    claims: labeled,
  };
}
