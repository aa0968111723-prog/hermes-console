import { mapTamkangTools, tamkangConfigured, tamkangStatus } from "../tamkang";
import { classifyFact } from "../audience";

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
  ];
}

export function researchBundle(input: {
  prompt: string;
  mcpReachable?: boolean;
  tools?: Array<{ name: string; description?: string }>;
}) {
  const tku = tamkangStatus({
    reachable: input.mcpReachable,
    tools: input.tools,
  });
  const sources = officialWebSources();
  const claims = [
    { claim: "淡江大學位於淡水。", sourceId: sources[0].url, category: "location" },
    {
      claim: "大一新生剛到淡水會期待認識新朋友。",
      sourceId: null,
      category: "social",
    },
    {
      claim: "All students love this event",
      sourceId: "https://seo.example/fake",
      category: "hype",
    },
  ];
  const labeled = claims.map((item) => ({
    ...item,
    kind:
      item.category === "hype"
        ? "hypothesis"
        : classifyFact(item.claim, item.sourceId),
  }));
  return {
    queries: /淡江|新生|淡水/.test(input.prompt) ? FRESHMAN_QUERIES : [],
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
